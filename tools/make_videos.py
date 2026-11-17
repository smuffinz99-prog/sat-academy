"""Rebuild the 20 lesson videos so the voice reads exactly what is on screen.

For every unit this writes videos/<unit>.mp4, .vtt, .chapters.json and
.poster.jpg, then refreshes media.json inside py.zip (transcript, chapters and
cache version) and the build id in index.html.

How it works
  1. Script. The lesson content in py.zip (short.py, notes.py and the worked
     example) becomes scenes made of lines. Every line is text on screen, and
     the narration is made from those same words, so the two always match.
  2. Speech. Each line is spoken by a neural voice (edge-tts), which also says
     when every word starts. Results are cached in tools/.cache.
  3. Timeline. Lines are joined with deliberate pauses. Slides build up line
     by line, and each word lights up as it is spoken.
  4. Frames. Microsoft Edge (through Playwright) renders tools/video_frame.html
     once per visual state, and ffmpeg turns the frames and audio into an MP4.

Run from the repo root:
  .venv/Scripts/python tools/make_videos.py            all 20 videos
  .venv/Scripts/python tools/make_videos.py B1 TRN     only these units
  .venv/Scripts/python tools/make_videos.py --check    script and speech only (no video)
"""
import asyncio
import difflib
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import time
import wave
import zipfile
from pathlib import Path

import edge_tts
import imageio_ffmpeg
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
CACHE = TOOLS / ".cache" / "tts"
WORK = TOOLS / ".work"
VIDEOS = ROOT / "videos"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

VOICE = "en-US-EmmaMultilingualNeural"
RATE = "-8%"            # a little slower than normal speech, so it's easy to read along
SR = 24000              # edge-tts audio sample rate
FPS = 30
TTS_PARALLEL = 6
RENDER_PARALLEL = 3

# Pauses, in seconds.
GAP_START = 0.6         # before the first line of the video
GAP_SCENE = 0.8         # from a scene change to its first line (the crossfade plays here)
GAP_TAIL = 0.4          # after the last line of a scene
GAP_HEAD = 0.4          # after a heading
GAP_ITEM = 0.55         # between items (cues, steps, rules, traps)
GAP_PART = 0.28         # between parts of one item (a step and its detail)
END_HOLD = 4.0          # the notes page stays up at the end
REVEAL_LEAD = 0.22      # a new line fades in just before it is spoken
FADE_FRAMES = 4         # fade-in for a new line
XFADE_FRAMES = 10       # crossfade between scenes

DOMAIN_COLOURS = {"II": "#FFE24D", "CS": "#FF8CC6", "EI": "#FFAE4A", "SEC": "#74C4FF"}
CHAPTERS = {1: "Spot it", 2: "The method", 3: "Rules", 4: "Worked example", 5: "The trap", 6: "Your notes"}
NUM_WORDS = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six"}

# ---------------------------------------------------------------------------------------------
# What the coach says during each worked example. One string per demo step in short.py, and the
# step's highlight/cross-out phrases come from short.py too.
# Markup:  *italic*  **bold**  [B] = answer-letter badge  {shown|spoken}
#          #h0 / #c0 = highlight / cross out phrase 0 of the step at this word
#          #xB / #pB = strike out / pick choice B at this word      #t = highlight the table cells
# The letter A is only ever said at the end of a sentence ("Choice A.") or in a list ("A, C,
# and D"), because the voice reads a lone "A" mid-sentence as the word "a".
DEMO = {
    "TRN": [
        "#h0 Most desert plants store water. The ocotillo #h1 *drops* its leaves. That's the opposite, so the link is contrast.",
        "#xA *For instance* gives an example. #xC *Similarly* means the same. #xD *Therefore* shows a result. Cross them all out.",
        "*However* is the only contrast word. Choice #pB [B].",
    ],
    "B1": [
        "The subject is #h0 *the Atacama Desert*. #c0 The part between the commas is extra. So where's the main verb? There isn't one yet.",
        "#xB *Receiving*, #xC *having received*, #xD *to receive*: none of these can be a main verb.",
        "*Receives* is a real main verb, so the sentence is complete. Choice #pA [A].",
    ],
    "WIC": [
        "#h0 *Although* sets up a contrast with her later work, which was #h1 *remarkably consistent*.",
        "And right after the blank: #h0 *results that differed every time*. So predict a simple word: *unreliable*.",
        "#xB *Influential*, #xC *inexpensive*, #xD *meticulous*: none of them mean unreliable. *Inconsistent* does. Choice #pA [A].",
    ],
    "F1": [
        "Cross out the *of* phrase: #c0 *of letters written by soldiers during the Civil War*.",
        "What's left? #h0 *The collection*. That's one thing, so the verb must be singular.",
        "#xA *Offer*, #xB *have offered*, and #xD *are offering* are all plural. *Offers* is singular. Choice #pC [C].",
    ],
    "CID": [
        "First, the old view: #h0 scientists assumed plants were passive.",
        "Then the turn, #h0 *however*: #h1 plants can detect signals and respond. That's the main idea.",
        "Too narrow: #xC [C], just one detail. Too extreme: #xD [D]. Not the point: #xA [A]. The answer is #pB [B].",
    ],
    "B2": [
        "Left side: #h0 a full sentence. Right side: #h1 another full sentence.",
        "*However* isn't a FANBOYS word, so #xA #xD a comma alone can't join them. And #xC no punctuation at all is a run-on.",
        "Semicolon before *however*, comma after. Choice #pB [B].",
    ],
    "RS": [
        "The goal: #h0 emphasize a difference in the lengths of the two spans. Your checklist: two bridges, a difference, and length.",
        "Cross out #xA [A], a similarity; #xB [B], a difference in dates; and #xD [D], which mentions only one bridge.",
        "#pC [C] ticks every box: two bridges, a difference, and length.",
    ],
    "F3": [
        "Time clues: #h0 {1825|eighteen twenty-five}, #h2 *took*, and #h1 *by the time*. It's all in the past.",
        "#xA *Completes* is present. #xD *Will complete* is future. #xB *Has completed* connects to now, not to the {1820s|eighteen twenties}.",
        "*Had completed* means finished before a point in the past. Choice #pC [C].",
    ],
    "COET": [
        "The claim: #h0 the lizards developed larger toe pads since the 2017 hurricane. Two parts: bigger toe pads, and a change after the storm.",
        "#xA Diet, #xC other species, #xD wind speed: none of them show that these lizards changed.",
        "#pB [B] shows bigger toe pads after the hurricane. That covers both parts.",
    ],
    "B3": [
        "Left side: #h0 *the ship's log revealed the cause of the delay.* That's a full sentence.",
        "#h0 The right side explains what the cause was.",
        "#xA A comma makes a splice. #xC Nothing makes a run-on. #xD *And* loses the link. A colon introduces the explanation. Choice #pB [B].",
    ],
    "INF": [
        "Fact one: #h0 the oldest layers have wild barley.",
        "Fact two: later layers show #h0 a trait that appears only when people farm barley.",
        "Combine them: farming started in between. Nothing in the text proves #xA [A], #xB [B], or #xD [D]. Choice #pC [C].",
    ],
    "F2": [
        "#c0 Skip the part between the commas.",
        "Who's celebrating? #h0 *The orchestra*. One group, so it's singular.",
        "#xA *Their* is plural. #xC *It's* means *it is*. #xD *They're* means *they are*. *Its* is singular and shows ownership. Choice #pB [B].",
    ],
    "TSP": [
        "Label each sentence. First, #h0 a common belief.",
        "Then, #h0 evidence against it.",
        "Then, #h0 a conclusion.",
        "Belief, evidence, conclusion. #xA #xC #xD Only #pB [B] has all three, in order.",
    ],
    "B4": [
        "#h0 Here's the extra information. It opens with a dash.",
        "#c0 Delete it: *the seed vault stores backup copies.* That's still a complete sentence.",
        "It opened with a dash, so #xA #xC #xD it must close with a dash. Choice #pB [B].",
    ],
    "COEQ": [
        "The claim has two parts: biking #h0 more than doubled, and walking #h1 stayed nearly the same.",
        "#t The table: biking went from 1.8 to 7.0. Walking went from 5.2 to 5.6.",
        "#xA [A], #xC [C], and #xD [D] are accurate, but each one misses part of the claim. Only #pB [B] shows both.",
    ],
    "F5": [
        "Does the word own the next one? The #h0 *campaign* belongs to the residents. #xA So yes, it's possessive.",
        "One resident, or many? Residents organising a campaign: #xB many.",
        "#xD Many owners: *s*, then the apostrophe. Choice #pC [C].",
    ],
    "CTC": [
        "Text 1: #h0 music causes better math scores.",
        "Text 2: #h0 it's true that musicians score higher, but #h1 we can't say music is the cause.",
        "#xA #xC #xD Text 2 agrees on the pattern, but questions the cause. Choice #pB [B].",
    ],
    "F4": [
        "#h0 *Born in Guatemala in {1939|nineteen thirty-nine}* describes a person.",
        "#xA The work wasn't born. #xB Her novels weren't born. #xD *It* wasn't born.",
        "Margarita Carrera was born, so her name goes right after the comma. Choice #pC [C].",
    ],
    "B5": [
        "#h0 This whole chunk is one long subject.",
        "Then the verb, *concluded*, then #h0 what they concluded. These parts belong together.",
        "#xB #xC #xD So no punctuation anywhere. Choice #pA [A].",
    ],
    "F6": [
        "What's being compared? #h0 *The diet of early farmers*.",
        "Diet versus people: #xA [A]. *Those* is plural: #xC [C]. And #xD [D] isn't grammatical.",
        "*That of the hunter-gatherers*: a diet compared to a diet. Choice #pB [B].",
    ],
}

# Display text the automatic rules can't voice well: replaced before tokenising. {shown|spoken}
SAY_FIX = {
    "A and B": "{A|Ay} and B",
    "(, ,  — —  ( ))": "{(, ,  — —  ( ))|— two commas, two dashes, or two brackets}",
    "not only … but also … must match": "{not only … but also …|not only, but also,} must match",
    "One: 's     Many: s'": "One: {’s|apostrophe s.} {·|} Many: {s’|s apostrophe.}",
    "Neither / nor": "{Neither / nor|Neither, nor}",
    "neither / nor": "{neither / nor|neither, nor}",
}


# =============================================================================================
# Text: markup → tokens (what is shown, what is said)
# =============================================================================================
def esc(s):
    return html.escape(s, quote=True)


_QUOTE = re.compile(r"(?<![\w’'])'(?=\S)((?:[^'\n]|'(?=\w))*?\S)'(?!\w)")


def smart(s):
    """Curly quotes for display. Lone 's and s' (possessive endings) are apostrophes, not quotes."""
    s = re.sub(r"(?<!\S)'s(?=\W|$)", "’s", s)
    s = re.sub(r"(?<!\S)s'(?=\W|$)", "s’", s)
    s = _QUOTE.sub(lambda m: "“" + m.group(1) + "”", s)
    return s.replace("'", "’")


def strip_style(chunk, bold, ital):
    """Remove *italic* / **bold** markers; return the text, its style, and the style carried on."""
    out, tb, ti = [], None, None
    for ch in chunk.replace("**", "\x01"):
        if ch == "\x01":
            bold = not bold
            continue
        if ch == "*":
            ital = not ital
            continue
        if tb is None and ch.isalnum():
            tb, ti = bold, ital
        out.append(ch)
    if tb is None:
        tb, ti = bold, ital
    return "".join(out), tb, ti, bold, ital


_SYMBOLS = {"+": "plus", "=": "means", "≠": "isn't", "/": "or", "&": "and", ";": "semicolon", "%": "percent",
            "…": "", "·": "", "—": "—", "–": "—", "-": "—"}
_KEEP_CAPS = {"DNA", "US", "UK", "OK", "TV"}


def speak(d, prev, nxt):
    """How the voice should say one shown token."""
    s = d.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    if re.fullmatch(r"_{2,}\W*", s):
        return "blank" + s.strip("_")
    bare = s.strip("()")
    if bare == "→":
        p, n = prev.strip(), nxt.strip()
        if p.endswith("?"):
            return "then"
        if re.search(r"\d[\d.,%]*$", p) and re.match(r"\d", n):
            return "to"
        return "means"
    if bare in _SYMBOLS:
        return _SYMBOLS[bare]
    m = re.match(r"^([\"'(\[]*)(.*?)([\"'.,;:!?)\]…]*)$", s)
    lead, core, trail = m.groups()
    trail = trail.replace("…", "")
    if lead.endswith("'") and core == "s":
        return "apostrophe s" + trail
    if core == "s" and trail.startswith("'"):
        return "s apostrophe" + trail[1:]
    if core.startswith("-") and core[1:].isalpha():
        core = core[1:]                                  # -ing → ing, -s → s
    core = core.replace("…", "")
    if core == "SAT":
        core = "S.A.T."
    elif core == "FANBOYS":
        core = "fanboys"
    elif core == "UN":
        core = "U.N."
    elif core in ("vs", "vs."):
        core = "versus"
    elif len(core) > 1 and core.isalpha() and core.isupper() and core not in _KEEP_CAPS:
        core = core.lower()                              # emphasis capitals (AND, NOT, MUST) are read normally
    return lead + core + trail


_TOK = re.compile(r"\{[^{}]*\}[^\s{]*|\S+")
_MARK = re.compile(r"#(?:([xp])([A-D])|([hc])(\d)|(t))$")
_LETTER = re.compile(r"\[([A-D])\](\W*)$")


def tokens_of(text, markup=True):
    """Split a line into tokens: d = shown text, say = spoken text, acts = actions at this word."""
    if markup:
        for k, v in SAY_FIX.items():
            text = text.replace(k, v)
    text = smart(text)
    toks, pending, bold, ital = [], [], False, False
    for m in _TOK.finditer(text):
        raw = m.group(0)
        if markup:
            mk = _MARK.match(raw)
            if mk:
                if mk.group(1):
                    pending.append((mk.group(1), mk.group(2)))
                elif mk.group(3):
                    pending.append((mk.group(3), int(mk.group(4))))
                else:
                    pending.append(("t", None))
                continue
        say = None
        if markup and raw.startswith("{") and "}" in raw and "|" in raw[:raw.index("}")]:
            close = raw.index("}")
            shown, say = raw[1:close].split("|", 1)
            tail = raw[close + 1:]                       # punctuation right after {…|…}
            raw, say = shown + tail, (say + tail).replace("’", "'")
        t = {"d": raw, "say": say, "acts": pending, "cls": []}
        pending = []
        lm = _LETTER.match(raw) if markup else None
        if lm:
            t["lt"], t["d"] = lm.group(1), lm.group(2)
        else:
            t["d"], t["b"], t["i"], bold, ital = strip_style(raw, bold, ital)
            if re.fullmatch(r"_{2,}\W*", t["d"]):
                t["blank"] = True
        toks.append(t)
    slashes = sum(1 for t in toks if t["d"] == "/")
    for k, t in enumerate(toks):
        if t["say"] is None and t["d"] == "/" and slashes >= 2:
            t["say"] = ","                               # "it / its / they" → "it, its, they"
        if t["say"] is None:
            if "lt" in t:
                tail = t["d"]
                letter = t["lt"]
                if letter == "A" and not tail.startswith((".", "?", "!")):
                    letter = "Ay"
                t["say"] = letter + tail
            else:
                prev = toks[k - 1]["d"] if k else ""
                nxt = toks[k + 1]["d"] if k + 1 < len(toks) else ""
                t["say"] = speak(t["d"], prev, nxt)
    return toks, pending


class Line:
    def __init__(self, lid, toks, end_acts):
        self.id, self.toks, self.end_acts = lid, toks, end_acts
        self.tt, self.dur, self.start, self.end, self.audio = [], 0.0, 0.0, 0.0, None

    @property
    def say(self):
        s = " ".join(t["say"] for t in self.toks if t["say"])
        s = re.sub(r"\s+", " ", s).strip()
        s = re.sub(r"\s+([,.;:!?])", r"\1", s)
        s = re.sub(r"\.\.+", ".", s)                    # "S.A.T." at the end of a sentence
        if s and s[-1] not in ".?!":
            s = s.rstrip(":;,—– ") + "."
        return s

    @property
    def caption(self):
        parts = []
        for t in self.toks:
            if "cap" in t:
                parts.append(t["cap"])
            elif "lt" in t:
                parts.append(t["lt"] + t["d"])
            elif t.get("blank"):
                parts.append("______" + t["d"].strip("_"))
            elif t["d"]:
                parts.append(t["d"])
        return re.sub(r"\s+", " ", " ".join(parts)).strip()

    def html(self, cls="", rv=True, tag="div"):
        parts = []
        for k, t in enumerate(self.toks):
            if k:
                parts.append(f'<span class="s" id="{self.id}s{k}"> </span>')
            c = ["w"] + (["b"] if t.get("b") else []) + (["i"] if t.get("i") else []) + t["cls"]
            if "lt" in t:
                inner = f'<i class="lt">{t["lt"]}</i>{esc(t["d"])}'
            elif t.get("blank"):
                inner = '<span class="blank"></span>' + esc(t["d"].strip("_"))
            else:
                inner = esc(t["d"])
            parts.append(f'<span class="{" ".join(c)}" id="{self.id}w{k}">{inner}</span>')
        classes = " ".join(x for x in ("ln", "rv" if rv else "", cls) if x)
        return f'<{tag} class="{classes}" id="{self.id}">{"".join(parts)}</{tag}>'


def norm(s):
    return re.sub(r"[^0-9a-z]", "", s.lower())


# =============================================================================================
# Script: lesson content → scenes and lines
# =============================================================================================
class Item:
    """One spoken line. reveal: elements that appear with it. pend: lines that appear with it but are
    read later (shown faded until then). focus: (element, class) held while it is read. dim: elements
    faded from now on. acts: (token index or "end", element, class) added at that word."""
    def __init__(self, line, gap, reveal=(), pend=(), focus=(), dim=(), undim=False, acts=()):
        self.line, self.gap = line, gap
        self.reveal, self.pend, self.focus, self.dim = list(reveal), list(pend), list(focus), list(dim)
        self.undim, self.acts = undim, list(acts)


class Scene:
    def __init__(self, sid, kind, num=None):
        self.id, self.kind, self.num = sid, kind, num
        self.chapter = CHAPTERS.get(num)
        self.items, self.html, self.t0 = [], "", 0.0
        self.todo = []          # lines on screen from the start that are read later (shown faded until then)

    def say(self, line, gap=0.0, **kw):
        self.items.append(Item(line, gap, **kw))


class Video:
    def __init__(self, unit, content, short, notes):
        self.unit = unit
        les = content["lessons"][unit]
        self.title = les["title"]
        self.module = les["moduleTitle"] if les["moduleTitle"] != les["title"] else les["domainTitle"]
        self.colour = DOMAIN_COLOURS[les["domain"]]
        self.s = short[unit]
        self.n = notes[unit]
        worked = {e["id"]: e for lst in content["worked"].values() for e in lst}
        self.ex = worked[self.s["demo"]["example"]]
        self.lines, self.scenes, self._n = {}, [], 0
        self.warnings = []

    def line(self, text, markup=True):
        self._n += 1
        toks, end_acts = tokens_of(text, markup)
        L = Line(f"L{self._n}", toks, end_acts)
        self.lines[L.id] = L
        return L

    def scene(self, kind, num=None):
        sc = Scene(f"s{len(self.scenes) + 1}", kind, num)
        self.scenes.append(sc)
        return sc

    def top(self, sc):
        prog = "".join(f'<i class="{"done" if i < sc.num else "now" if i == sc.num else ""}"></i>' for i in range(1, 7))
        return (f'<div class="top"><span class="dot"></span><span>{esc(self.title)}</span>'
                f'<span class="pill"><b>{sc.num}</b>{esc(sc.chapter)}</span></div><div class="prog">{prog}</div>')

    # ----------------------------------------------------------------- the question card
    def card(self, sc):
        ex = self.ex
        plines, parts = [], []
        for raw in ex["passage"].strip().split("\n"):
            raw = raw.strip()
            if not raw:
                continue
            if re.fullmatch(r"\*\*[^*]+\*\*", raw):
                kind, text = "h", raw.strip("*")
            elif raw.startswith("- "):
                kind, text = "li", raw[2:]
            else:
                kind, text = "p", raw
            L = self.line(text, markup=False)
            plines.append((kind, L))
            parts.append(L.html(cls={"h": "ph", "li": "li", "p": ""}[kind], rv=False))
        regions = {"passage": f"{sc.id}-passage", "choices": f"{sc.id}-choices"}
        for _, L in plines:
            for k, t in enumerate(L.toks):
                if t.get("blank"):
                    regions["blank"] = f"{L.id}w{k}"
        table = ""
        data = ex.get("data")
        if data and data.get("type") == "table":
            regions["data"] = f"{sc.id}-data"
            head = "".join(f"<th>{esc(c)}</th>" for c in data["columns"])
            rows = "".join("<tr>" + "".join(f'<td id="{sc.id}-c{r}-{c}">{esc(v)}</td>' for c, v in enumerate(row)) + "</tr>"
                           for r, row in enumerate(data["rows"]))
            table = (f'<table class="data" id="{sc.id}-data"><caption>{esc(data.get("title", ""))}</caption>'
                     f"<tr>{head}</tr>{rows}</table>")
        stem = self.line(ex["question"], markup=False)
        regions["stem"] = stem.id
        choices = "".join(f'<div class="choice" id="{sc.id}-ch{L}"><span class="L">{L}</span><span class="ct">{esc(smart(c))}</span></div>'
                          for L, c in zip("ABCD", ex["choices"]))
        html_ = (f'<div class="qcard"><div class="qp" id="{sc.id}-passage">{"".join(parts)}{table}</div><div class="qdiv"></div>'
                 f'<div class="qq">{stem.html(cls="stem", rv=False)}<div class="choices" id="{sc.id}-choices">{choices}</div></div></div>')
        return html_, plines, stem, regions

    def phrase_ids(self, phrase, lines):
        """Token and space ids covering a phrase in the passage (or the question)."""
        want = [norm(w) for w in phrase.split() if norm(w)]
        seq = []
        for L in lines:
            for k, t in enumerate(L.toks):
                n = norm(t["d"])
                if n:
                    seq.append((n, L, k))
        for i in range(len(seq) - len(want) + 1):
            if all(seq[i + j][0] == want[j] for j in range(len(want))):
                ids = []
                for j in range(len(want)):
                    _, L, k = seq[i + j]
                    if j and seq[i + j - 1][1] is L:
                        ids += [f"{L.id}s{kk}" for kk in range(seq[i + j - 1][2] + 1, k + 1)]
                    ids.append(f"{L.id}w{k}")
                return ids
        self.warnings.append(f"phrase not found in passage: {phrase!r}")
        return []

    # ----------------------------------------------------------------- scenes
    def build(self):
        s, n = self.s, self.n

        # 1. Title
        sc = self.scene("title")
        L1, L2 = self.line(self.title), self.line(s["tagline"])
        sc.html = (f'<div class="tbox" data-fit="{sc.id}"><div><div class="kicker"><span class="dot"></span>{esc(self.module)}</div>'
                   f'{L1.html(cls="ttl", rv=False)}{L2.html(cls="tag")}</div></div>'
                   f'<div class="brand"><i>R&amp;W</i>SAT Reading &amp; Writing</div>')
        sc.say(L1)
        sc.say(L2, GAP_PART + 0.1)

        # 2. How to spot it
        sc = self.scene("spot", 1)
        card, _, _, regions = self.card(sc)
        head = self.line("How to spot it")
        cues = [(self.line(cue_text(c)), target) for c, target in s["spot"]]
        test = self.line("**It's testing:** " + s["testing"])
        side = head.html(cls="hd") + "".join(L.html(cls="cue") for L, _ in cues) + test.html(cls="testing")
        sc.html = (self.top(sc) + f'<div class="cardbox" style="left:80px;top:140px;width:1040px;bottom:80px;font-size:30px" '
                   f'data-fit="{sc.id}c">{card}</div><div class="side" data-fit="{sc.id}s"><div>{side}</div></div>')
        sc.say(head)
        for i, (L, target) in enumerate(cues):
            region = regions.get(target) or regions["passage"]
            sc.say(L, GAP_HEAD if i == 0 else GAP_ITEM, focus=[(region, "focus")])
        sc.say(test, GAP_ITEM)

        # 3. The method
        sc = self.scene("method", 2)
        head = self.line("The method")
        steps = []
        for i, (h, d) in enumerate(s["attack"], 1):
            Lh = self.line(f"{{{i}|Step {i}:}} {h}")
            Lh.toks[0]["cls"] = ["num"]
            Lh.toks[0]["cap"] = f"Step {i}:"
            steps.append((f"{sc.id}-st{i}", Lh, self.line(d)))
        lab, big = self.line("In a few words"), self.line(s["mantra"])
        body = head.html(cls="hd") + "".join(f'<div class="mstep rv" id="{sid}">{Lh.html(cls="head", rv=False)}{Ld.html(cls="detail", rv=False)}</div>'
                                             for sid, Lh, Ld in steps)
        sc.html = (self.top(sc) + f'<div class="mbox" data-fit="{sc.id}"><div>{body}</div></div>'
                   f'<div class="mantra rv" id="{sc.id}-mantra">{lab.html(cls="lab", rv=False)}{big.html(cls="big", rv=False)}</div>')
        sc.say(head)
        for i, (sid, Lh, Ld) in enumerate(steps):
            sc.say(Lh, GAP_HEAD if i == 0 else GAP_ITEM, reveal=[sid], pend=[Ld.id], dim=[x[0] for x in steps[:i]])
            sc.say(Ld, GAP_PART)
        sc.say(lab, GAP_ITEM, reveal=[f"{sc.id}-mantra"], pend=[big.id], undim=True)
        sc.say(big, 0.15)

        # 4. Rules
        sc = self.scene("rules", 3)
        head = self.line(s.get("rules_title") or "The rules")
        rules = s["rules"]
        cols = 1 if len(rules) == 1 else 2 if len(rules) in (2, 4) else 3
        rows = -(-len(rules) // cols)
        cards, chtml = [], []
        for j, r in enumerate(rules):
            cid = f"{sc.id}-r{j}"
            lines = [(self.line(r["name"]), "rname")]
            if r.get("text"):
                lines.append((self.line(r["text"]), "rtext"))
            for key, icon, word in (("bad", "✗", "Wrong:"), ("good", "✓", "Right:")):
                if r.get(key):
                    L = self.line(f"{{{icon}|{word}}} {r[key]}")
                    L.toks[0]["cls"] = ["ic", key]
                    L.toks[0]["cap"] = word
                    lines.append((L, "rex"))
            cards.append((cid, lines))
            chtml.append(f'<div class="rcard rv" id="{cid}">' + "".join(L.html(cls=c, rv=False) for L, c in lines) + "</div>")
        sc.html = (self.top(sc) + head.html(cls="rhead") +
                   f'<div class="rbox" data-fit="{sc.id}r"><div class="rgrid c{cols}">{"".join(chtml)}</div></div>')
        sc.say(head)
        for j, (cid, lines) in enumerate(cards):
            for i, (L, _) in enumerate(lines):
                if i == 0:
                    sc.say(L, GAP_HEAD if j == 0 else GAP_ITEM, reveal=[cid], pend=[x.id for x, _ in lines[1:]], focus=[(cid, "cur")])
                else:
                    sc.say(L, GAP_PART, focus=[(cid, "cur")])

        # 5. Worked example
        sc = self.scene("example", 4)
        card, plines, stem, regions = self.card(sc)
        head = self.line("Let's try one")
        demo = self.s["demo"]["steps"]
        texts = DEMO[self.unit]
        assert len(texts) == len(demo), self.unit + ": DEMO needs one text per demo step"
        coach = [self.line(t) for t in texts]
        sc.html = (self.top(sc) + f'<div class="cardbox" style="left:70px;top:118px;width:1160px;bottom:58px;font-size:30px" '
                   f'data-fit="{sc.id}c">{card}</div>'
                   f'<div class="coach" data-fit="{sc.id}k"><div>{head.html(cls="hd")}{"".join(L.html(cls="step") for L in coach)}</div></div>')
        sc.say(head)
        prev_kind = None
        for i, (kind, L) in enumerate(plines):
            gap = GAP_HEAD if i == 0 else (0.25 if "h" in (kind, prev_kind) else GAP_PART + 0.1)
            sc.say(L, gap)
            prev_kind = kind
        sc.todo = [L.id for _, L in plines]
        # The standard grammar / vocabulary question is skipped: the spot section already covered it.
        if not re.search(r"conventions of Standard English|most logical transition|logical and precise word", self.ex["question"]):
            sc.say(stem, GAP_ITEM)
            sc.todo.append(stem.id)
        search = [L for _, L in plines] + [stem]
        struck_by_marker = {a[1] for L in coach for t in L.toks + [{"acts": L.end_acts}] for a in t["acts"] if a[0] in "xp"}
        picked = None
        for i, (st, L) in enumerate(zip(demo, coach)):
            acts, used = [], set()
            for k, t in enumerate(L.toks + [{"acts": L.end_acts}]):
                at = k if k < len(L.toks) else "end"
                for op, arg in t["acts"]:
                    used.add((op, arg))
                    if op == "x":
                        acts.append((at, f"{sc.id}-ch{arg}", "strike"))
                    elif op == "p":
                        acts.append((at, f"{sc.id}-ch{arg}", "pick"))
                        picked = arg
                    elif op in "hc":
                        phrases = st["hl"] if op == "h" else st["cross"]
                        if arg >= len(phrases):
                            self.warnings.append(f"step {i + 1}: #{op}{arg} has no phrase")
                            continue
                        acts += [(at, x, "hl" if op == "h" else "x") for x in self.phrase_ids(phrases[arg], search)]
                    elif op == "t":
                        acts += [(at, f"{sc.id}-c{r}-{c}", "cellhl") for r, c in st["cells"]]
            for op, key in (("h", "hl"), ("c", "cross")):        # phrases with no marker light up at the start
                for j, ph in enumerate(st[key]):
                    if (op, j) not in used:
                        acts += [(0, x, "hl" if op == "h" else "x") for x in self.phrase_ids(ph, search)]
            if st["cells"] and ("t", None) not in used:
                acts += [(0, f"{sc.id}-c{r}-{c}", "cellhl") for r, c in st["cells"]]
            for letter in st["strike"]:
                if letter not in struck_by_marker:
                    acts.append(("end", f"{sc.id}-ch{letter}", "strike"))
            if st.get("pick") and st["pick"] not in struck_by_marker:
                acts.append(("end", f"{sc.id}-ch{st['pick']}", "pick"))
                picked = st["pick"]
            sc.say(L, GAP_ITEM + 0.1 if i == 0 else GAP_ITEM, dim=[c.id for c in coach[:i]], acts=acts)
        if picked != self.ex["answer"]:
            self.warnings.append(f"the video picks {picked} but the answer is {self.ex['answer']}")

        # 6. Traps
        sc = self.scene("traps", 5)
        traps = s["traps"]
        head = self.line("Common traps" if len(traps) > 1 else "The trap")
        tcards, thtml = [], []
        for j, (name, desc) in enumerate(traps):
            cid = f"{sc.id}-t{j}"
            Ln, Ld = self.line(name), self.line(desc)
            tcards.append((cid, Ln, Ld))
            thtml.append(f'<div class="tcard rv" id="{cid}"><div class="warn">!</div><div>{Ln.html(cls="tname", rv=False)}{Ld.html(cls="tdesc", rv=False)}</div></div>')
        sc.html = self.top(sc) + f'<div class="tbox2" data-fit="{sc.id}"><div>{head.html(cls="hd")}{"".join(thtml)}</div></div>'
        sc.say(head)
        for j, (cid, Ln, Ld) in enumerate(tcards):
            sc.say(Ln, GAP_HEAD if j == 0 else GAP_ITEM, reveal=[cid], pend=[Ld.id])
            sc.say(Ld, GAP_PART)

        # 7. Notes page
        sc = self.scene("notes", 6)
        Lt, Lm = self.line(self.title), self.line(s["mantra"])
        Lsl, Ls = self.line("Spot it"), self.line(n["spot"])
        Lstl = self.line("Steps")
        Lsteps = []
        for i, txt in enumerate(n["steps"], 1):
            L = self.line(f"{{{i}|{NUM_WORDS[i]},}} {txt}")
            L.toks[0]["cls"] = ["num"]
            L.toks[0]["cap"] = f"{i}."
            Lsteps.append(L)
        Lrl = self.line("Remember")
        Lrem = [self.line(x) for x in n["remember"]]
        Ltl, Ltr = self.line("Trap"), self.line(n["trap"])
        Lban = self.line("Pause the video now, and copy this page into your notes.")
        left = (Lsl.html(cls="plab") + Ls.html(cls="pl") + Lstl.html(cls="plab") + "".join(L.html(cls="pl pn") for L in Lsteps))
        right = (Lrl.html(cls="plab") + "".join(L.html(cls="pl pb") for L in Lrem) + Ltl.html(cls="plab") + Ltr.html(cls="pl"))
        sc.html = (self.top(sc) + f'<div class="pagebox" data-fit="{sc.id}"><div class="page">{Lt.html(cls="ptitle", rv=False)}'
                   f'{Lm.html(cls="mant")}<div class="pcols"><div>{left}</div><div>{right}</div></div></div></div>'
                   f'<div class="banner rv" id="{sc.id}-ban"><span class="pz"></span>{Lban.html(rv=False, tag="span")}</div>')
        sc.say(Lt)
        sc.say(Lm, GAP_PART)
        sc.say(Lsl, GAP_ITEM)
        sc.say(Ls, 0.2)
        sc.say(Lstl, GAP_ITEM)
        for i, L in enumerate(Lsteps):
            sc.say(L, 0.2 if i == 0 else GAP_PART)
        sc.say(Lrl, GAP_ITEM)
        for i, L in enumerate(Lrem):
            sc.say(L, 0.2 if i == 0 else GAP_PART)
        sc.say(Ltl, GAP_ITEM)
        sc.say(Ltr, 0.2)
        sc.say(Lban, GAP_ITEM + 0.2, reveal=[f"{sc.id}-ban"])
        return self


def cue_text(c):
    """A cue that is only a quote reads better as 'The question says “…”'."""
    c = c.strip()
    if c.startswith("'"):
        c = re.sub(r"'([^']+)'", lambda m: "'" + (m.group(1) if m.group(1).startswith("Text") else m.group(1)[:1].lower() + m.group(1)[1:]) + "'", c)
        return "The question says " + c
    return c


# =============================================================================================
# Speech
# =============================================================================================
async def synth(text, sem):
    key = hashlib.sha1(f"{VOICE}|{RATE}|{text}".encode()).hexdigest()[:20]
    mp3, meta = CACHE / f"{key}.mp3", CACHE / f"{key}.json"
    if mp3.exists() and meta.exists():
        return mp3, json.loads(meta.read_text(encoding="utf-8"))
    async with sem:
        last = None
        for attempt in range(6):
            try:
                comm = edge_tts.Communicate(text, VOICE, rate=RATE, boundary="WordBoundary")
                audio, words = bytearray(), []
                async for ch in comm.stream():
                    if ch["type"] == "audio":
                        audio += ch["data"]
                    elif ch["type"] == "WordBoundary":
                        words.append([ch["offset"] / 1e7, ch["duration"] / 1e7, ch["text"]])
                if not audio or not words:
                    raise RuntimeError("empty response")
                mp3.write_bytes(bytes(audio))
                meta.write_text(json.dumps(words), encoding="utf-8")
                return mp3, words
            except Exception as e:      # network hiccups: back off and retry
                last = e
                await asyncio.sleep(2 + 3 * attempt)
        raise RuntimeError(f"speech failed for {text!r}: {last}")


def decode(mp3):
    out = subprocess.run([FFMPEG, "-v", "error", "-i", str(mp3), "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0


def align(line, words):
    """Map the voice's word timings onto the line's tokens (by characters, so 1,991 or S.A.T. still match)."""
    exp, owner = [], []
    for k, t in enumerate(line.toks):
        for ch in norm(t["say"]):
            exp.append(ch)
            owner.append(k)
    got, gt = [], []
    for off, dur, txt in words:
        for ch in norm(txt):
            got.append(ch)
            gt.append((off, off + dur))
    start, end = [None] * len(line.toks), [None] * len(line.toks)
    hits = 0
    for a, b, size in difflib.SequenceMatcher(None, exp, got, autojunk=False).get_matching_blocks():
        for j in range(size):
            k = owner[a + j]
            s, e = gt[b + j]
            if start[k] is None:
                start[k] = s
            end[k] = e if end[k] is None else max(end[k], e)
            hits += 1
    return start, end, hits / max(1, len(exp))


async def speak_all(videos):
    CACHE.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(TTS_PARALLEL)
    jobs = {}
    for V in videos:
        for sc in V.scenes:
            for it in sc.items:
                jobs.setdefault(it.line.say, None)
    texts = list(jobs)
    print(f"speech: {len(texts)} lines", flush=True)
    results = await asyncio.gather(*(synth(t, sem) for t in texts))
    return dict(zip(texts, results))


def prepare_audio(V, speech):
    for sc in V.scenes:
        for it in sc.items:
            L = it.line
            mp3, words = speech[L.say]
            a = decode(mp3)
            loud = np.where(np.abs(a) > 10 ** (-40 / 20))[0]
            if len(loud):
                s0, s1 = max(0, loud[0] - int(0.03 * SR)), min(len(a), loud[-1] + int(0.09 * SR))
            else:
                s0, s1 = 0, len(a)
            L.audio = a[s0:s1]
            L.dur = len(L.audio) / SR
            cut = s0 / SR
            start, end, cov = align(L, words)
            if cov < 0.85:
                V.warnings.append(f"word timing only {cov:.0%} matched for {L.say!r}")
            # Tokens the voice doesn't time (dashes, badges said as part of a word) take the next word's time.
            tt, nxt = [0.0] * len(L.toks), L.dur
            for k in range(len(L.toks) - 1, -1, -1):
                if start[k] is not None:
                    nxt = min(max(0.0, start[k] - cut), L.dur)
                tt[k] = nxt
            for k in range(1, len(tt)):
                tt[k] = max(tt[k], tt[k - 1])
            L.tt = tt
            for k, t in enumerate(L.toks):     # a lone "A" spoken too short was read as the word "a"
                if t.get("lt") == "A" and start[k] is not None and end[k] - start[k] < 0.15:
                    V.warnings.append(f"letter A may sound like 'a' in {L.say!r}")


# =============================================================================================
# Timeline: lines + pauses → audio track, visual states, captions, chapters
# =============================================================================================
def compile_timeline(V):
    events, seq = [], [0]

    def ev(t, kind, *args):
        events.append((t, seq[0], kind, args))
        seq[0] += 1

    t = 0.0
    chapters = []
    for si, sc in enumerate(V.scenes):
        sc.t0 = t
        ev(t, "scene", sc)
        if sc.chapter:
            chapters.append({"t": round(t, 2), "label": sc.chapter})
        t += GAP_START if si == 0 else GAP_SCENE
        prev_end = None
        for ii, it in enumerate(sc.items):
            L = it.line
            if ii:
                t += it.gap
            earliest = (prev_end + 0.03) if prev_end is not None else sc.t0 + (XFADE_FRAMES + 2) / FPS
            ev(max(earliest, t - REVEAL_LEAD), "pre", it)
            ev(t, "act", L.id)
            for k, tt in enumerate(L.tt):
                ev(t + tt, "word", L.id, k)
            for at, el, cls in it.acts:
                ev(t + (max(0.0, L.dur - 0.25) if at == "end" else L.tt[at]), "add", el, cls)
            L.start, L.end = t, t + L.dur
            t += L.dur
            ev(t, "done", L.id)
            prev_end = t
        t += GAP_TAIL
    total = t - GAP_TAIL + END_HOLD

    events.sort(key=lambda e: (e[0], e[1]))
    snaps = []
    st = None
    for tm, _, kind, args in events:
        if kind == "scene":
            st = {"scene": args[0].id, "vis": set(), "act": None, "k": -1, "focus": [],
                  "persist": {lid: {"todo"} for lid in args[0].todo}}
        elif kind == "pre":
            it = args[0]
            st["vis"].update(it.reveal)
            st["vis"].add(it.line.id)
            st["focus"] = it.focus
            for lid in it.pend:
                st["persist"].setdefault(lid, set()).add("todo")
            if it.undim:
                for cl in st["persist"].values():
                    cl.discard("dim")
            for el in it.dim:
                st["persist"].setdefault(el, set()).add("dim")
        elif kind == "act":
            st["act"], st["k"] = args[0], -1
            st["persist"].get(args[0], set()).discard("todo")
        elif kind == "word":
            if st["act"] == args[0]:
                st["k"] = args[1]
        elif kind == "add":
            st["persist"].setdefault(args[0], set()).add(args[1])
        elif kind == "done":
            if st["act"] == args[0]:
                st["act"], st["k"] = None, -1
        cls = {el: set(c) for el, c in st["persist"].items() if c}
        for el, c in st["focus"]:
            cls.setdefault(el, set()).add(c)
        snaps.append((tm, {"scene": st["scene"], "vis": sorted(st["vis"]), "act": st["act"], "k": st["k"],
                           "cls": {el: sorted(c) for el, c in sorted(cls.items())}}))
    return snaps, total, chapters


def build_audio(V, total, path):
    buf = np.zeros(int(total * SR) + SR, dtype=np.float32)
    for sc in V.scenes:
        for it in sc.items:
            L = it.line
            i = int(round(L.start * SR))
            buf[i:i + len(L.audio)] += L.audio
    pcm = (np.clip(buf[:int(total * SR)], -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def vtt_time(t):
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def build_vtt(V):
    cues = []
    for sc in V.scenes:
        for it in sc.items:
            L = it.line
            words = L.caption.split(" ") if L.caption else []
            # Long lines (passages) are split into caption-sized pieces at sentence or clause ends.
            if len(L.caption) <= 90:
                cues.append((L.start, L.end, L.caption))
                continue
            chunk, cstart = [], None
            caps = []
            for k, t in enumerate(L.toks):
                piece = t.get("cap") or (t["lt"] + t["d"] if "lt" in t else ("______" + t["d"].strip("_") if t.get("blank") else t["d"]))
                if not piece:
                    continue
                if cstart is None:
                    cstart = L.start + L.tt[k]
                chunk.append(piece)
                text = " ".join(chunk)
                ends = piece.endswith((".", "?", "!", ";", ":")) and len(text) > 30
                if ends or (piece.endswith(",") and len(text) > 70) or len(text) > 95:
                    nxt = L.start + L.tt[k + 1] if k + 1 < len(L.toks) else L.end
                    caps.append((cstart, nxt, text))
                    chunk, cstart = [], None
            if chunk:
                caps.append((cstart, L.end, " ".join(chunk)))
            cues += caps
    out = ["WEBVTT", ""]
    for s, e, text in cues:
        if text:
            out += [f"{vtt_time(s)} --> {vtt_time(max(e, s + 0.3))}", text, ""]
    return "\n".join(out)


# =============================================================================================
# Frames and video
# =============================================================================================
def page_html(V):
    tpl = (TOOLS / "video_frame.html").read_text(encoding="utf-8")
    fonts = (ROOT / "fonts").resolve().as_uri()
    scenes = "".join(f'<section class="scene" id="{sc.id}">{sc.html}</section>' for sc in V.scenes)
    return tpl.replace("__FONTS__", fonts).replace("__SCENES__", scenes).replace("<body>", f'<body style="--dc:{V.colour}">', 1)


async def render_video(V, browser, snaps, total, chapters, sem, log):
    async with sem:
        t0 = time.time()
        work = WORK / V.unit
        shutil.rmtree(work, ignore_errors=True)
        frames_dir = work / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        for old in frames_dir.iterdir():
            old.unlink()
        html_path = work / "frame.html"
        html_path.write_text(page_html(V), encoding="utf-8")
        page = await browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        await page.goto(html_path.resolve().as_uri())
        await page.evaluate("""async () => { await document.fonts.load('800 40px "Atkinson Next"'); await document.fonts.load('italic 400 40px "Atkinson Next"');
                                             await document.fonts.load('400 40px "Atkinson Next"'); await document.fonts.ready; return 1; }""")
        for r in await page.evaluate("fitAll()"):
            if r["overflow"]:
                V.warnings.append(f"text still too big for its box: {r['group']} at {r['size']}px")

        # One screenshot per distinct visual state.
        sched, last_f = [], -1
        for tm, state in snaps:
            f = int(round(tm * FPS))
            if sched and sched[-1][0] == f:
                sched[-1] = (f, state)
            else:
                sched.append((f, state))
        files, shots = {}, 0
        for f, state in sched:
            key = json.dumps(state, sort_keys=True)
            if key not in files:
                path = frames_dir / f"f{len(files):05d}.png"
                await page.evaluate("s => applyState(s)", state)
                await page.screenshot(path=str(path), type="png", animations="disabled", caret="hide")
                files[key] = path
                shots += 1
        # Poster: the title slide with everything shown.
        title = V.scenes[0]
        poster_state = {"scene": title.id, "vis": [it.line.id for it in title.items], "act": None, "k": -1, "cls": {}}
        poster_tmp = work / "poster.jpg"
        await page.evaluate("s => applyState(s)", poster_state)
        await page.screenshot(path=str(poster_tmp), type="jpeg", quality=95)
        await page.close()

        concat = await asyncio.to_thread(build_frame_list, sched, files, frames_dir, total)
        wav = work / "narration.wav"
        await asyncio.to_thread(build_audio, V, total, wav)
        out = work / f"{V.unit}.mp4"
        keys = ",".join(f"{c['t']:.2f}" for c in chapters)
        cmd = [FFMPEG, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-i", str(wav),
               "-map", "0:v", "-map", "1:a",
               "-vf", "fps=30,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
               "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
               "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage", "-crf", "22", "-g", "300", "-force_key_frames", keys,
               "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-c:a", "aac", "-b:a", "96k", "-ac", "1",
               "-movflags", "+faststart", "-t", f"{total:.3f}", str(out)]
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _, err = await proc.communicate()
        if proc.returncode:
            raise RuntimeError(f"ffmpeg failed for {V.unit}: {err.decode(errors='replace')[-2000:]}")
        shutil.rmtree(frames_dir, ignore_errors=True)       # ~100 MB of screenshots per video
        Image.open(poster_tmp).convert("RGB").resize((1280, 720), Image.LANCZOS).save(work / "poster_small.jpg", quality=86)
        log(f"{V.unit}: {shots} frames, {total:.0f}s video, rendered in {time.time() - t0:.0f}s")
        return out, work / "poster_small.jpg"


def build_frame_list(sched, files, frames_dir, total):
    """Frame list for ffmpeg, with a short fade when lines appear and a crossfade between scenes."""
    total_f = int(round(total * FPS))
    entries = []          # (path, frames)
    blend_n = 0
    for i, (f, state) in enumerate(sched):
        end_f = sched[i + 1][0] if i + 1 < len(sched) else total_f
        if end_f <= f:
            continue
        path = files[json.dumps(state, sort_keys=True)]
        fade = 0
        if i:
            prev = sched[i - 1][1]
            if prev["scene"] != state["scene"]:
                fade = XFADE_FRAMES
            elif prev["vis"] != state["vis"]:
                fade = FADE_FRAMES
        fade = min(fade, end_f - f - 1)
        if fade > 0:
            a = Image.open(files[json.dumps(sched[i - 1][1], sort_keys=True)]).convert("RGB")
            b = Image.open(path).convert("RGB")
            for j in range(fade):
                alpha = (j + 1) / (fade + 1)
                alpha = alpha * alpha * (3 - 2 * alpha)          # ease in-out
                bp = frames_dir / f"b{blend_n:05d}.png"
                Image.blend(a, b, alpha).save(bp, compress_level=1)
                blend_n += 1
                entries.append((bp, 1))
            f += fade
        entries.append((path, end_f - f))
    lst = frames_dir / "frames.txt"
    with open(lst, "w", encoding="utf-8") as fh:
        fh.write("ffconcat version 1.0\n")
        for p, n in entries:
            fh.write(f"file '{p.as_posix()}'\nduration {n / FPS:.6f}\n")
        fh.write(f"file '{entries[-1][0].as_posix()}'\n")
    return lst


# =============================================================================================
# Main
# =============================================================================================
def load_content():
    d = WORK / "py"
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    with zipfile.ZipFile(ROOT / "py.zip") as z:
        z.extractall(d)
    sys.path.insert(0, str(d))
    import content                      # noqa: E402  (the app's own lesson content)
    from content.short import SHORT
    from content.notes import NOTES
    return content.CONTENT, SHORT, NOTES


def update_app(results):
    """Write media.json into py.zip and give index.html a new build id so browsers fetch it."""
    zpath = ROOT / "py.zip"
    with zipfile.ZipFile(zpath) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
        media = json.loads(z.read("media.json"))
    for unit, info in results.items():
        media[unit] = info
    tmp = zpath.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for info, data in entries:
            if info.filename == "media.json":
                data = json.dumps(media, indent=1, ensure_ascii=False).encode("utf-8")
            z.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
    tmp.replace(zpath)
    idx = ROOT / "index.html"
    text = idx.read_text(encoding="utf-8")
    old = re.search(r'data-build="([0-9a-f]+)"', text).group(1)
    new = hashlib.sha1(zpath.read_bytes()).hexdigest()[:10]
    idx.write_text(text.replace(old, new), encoding="utf-8")
    return old, new


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_only = "--check" in sys.argv
    content, short, notes = load_content()
    units = args or list(content["sequence"])
    t0 = time.time()
    videos = [Video(u, content, short, notes).build() for u in units]

    script = WORK / "scripts.txt"
    with open(script, "w", encoding="utf-8") as fh:
        for V in videos:
            fh.write(f"===== {V.unit}: {V.title}\n")
            for sc in V.scenes:
                fh.write(f"--- {sc.chapter or 'Title'}\n")
                for it in sc.items:
                    shown = it.line.caption
                    fh.write(f"  {it.line.say}\n" + (f"    [screen] {shown}\n" if norm(shown) != norm(it.line.say) else ""))
    print(f"script written to {script}", flush=True)

    speech = await speak_all(videos)
    for V in videos:
        prepare_audio(V, speech)
    print(f"speech ready in {time.time() - t0:.0f}s", flush=True)

    plans = {}
    for V in videos:
        snaps, total, chapters = compile_timeline(V)
        plans[V.unit] = (snaps, total, chapters)
        print(f"  {V.unit}: {total:.0f}s, {len(snaps)} timeline events", flush=True)
    if check_only:
        for V in videos:
            for w in V.warnings:
                print(f"  ! {V.unit}: {w}")
        return

    def log(msg):
        print("  " + msg, flush=True)

    results = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="msedge")
        sem = asyncio.Semaphore(RENDER_PARALLEL)
        outs = await asyncio.gather(*(render_video(V, browser, *plans[V.unit], sem, log) for V in videos))
        await browser.close()

    VIDEOS.mkdir(exist_ok=True)
    for V, (mp4, poster) in zip(videos, outs):
        snaps, total, chapters = plans[V.unit]
        shutil.copyfile(mp4, VIDEOS / f"{V.unit}.mp4")
        shutil.copyfile(poster, VIDEOS / f"{V.unit}.poster.jpg")
        vtt = build_vtt(V)
        (VIDEOS / f"{V.unit}.vtt").write_text(vtt, encoding="utf-8")
        (VIDEOS / f"{V.unit}.chapters.json").write_text(json.dumps(chapters), encoding="utf-8")
        results[V.unit] = {"v": hashlib.sha1((VIDEOS / f"{V.unit}.mp4").read_bytes()).hexdigest()[:10],
                           "transcript": vtt, "chapters": chapters}
    old, new = update_app(results)
    print(f"app updated: build {old} -> {new}")
    for V in videos:
        for w in V.warnings:
            print(f"  ! {V.unit}: {w}")
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    asyncio.run(main())
