"""Speech for tools/make_videos.py, made with Kokoro (an open-source voice model that runs on this PC).

Runs in the tools/.tts environment (Python 3.12):
  tools/.tts/Scripts/python tools/kokoro_tts.py < jobs.json

jobs.json: {"voice": "af_heart" | "af_bella=0.65+jf_alpha=0.35", "speed": 0.9, "cute": [pitch, formant] | null,
            "items": [{"text": "...", "out": "path/without/extension"}, ...]}
For each item it writes <out>.wav (24 kHz mono) and <out>.json: [[start, end, word], ...].

Kokoro (like most voices) barely pauses at commas, so a real pause is cut into the audio after every
comma, colon and full stop. "cute" optionally raises the pitch and brightens the tone (Praat).
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np                      # noqa: E402
import soundfile as sf                  # noqa: E402
from kokoro import KPipeline            # noqa: E402

SR = 24000
# Extra silence after punctuation, in seconds (added to the voice's own short pause).
EXTRA = {",": 0.24, ";": 0.32, ":": 0.32, "—": 0.26, "–": 0.26, ".": 0.32, "?": 0.32, "!": 0.32, "…": 0.3}
FADE = int(0.004 * SR)


def voice_of(pipe, spec):
    if "=" not in spec:
        return spec
    total = None
    for part in spec.split("+"):
        name, weight = part.split("=")
        t = pipe.load_voice(name.strip()) * float(weight)
        total = t if total is None else total + t
    return total


def synth(pipe, text, voice, speed):
    audio, toks, offset = [], [], 0.0
    for r in pipe(text, voice=voice, speed=speed, split_pattern=None):
        a = r.audio.numpy().astype(np.float32)
        for t in r.tokens or []:
            if t.start_ts is not None and t.end_ts is not None:
                toks.append((t.text, t.start_ts + offset, t.end_ts + offset))
        audio.append(a)
        offset += len(a) / SR
    return (np.concatenate(audio) if audio else np.zeros(SR // 10, np.float32)), toks


def quietest(seg):
    """Index of the quietest 10 ms in a stretch of audio (where a cut can't be heard)."""
    win = int(0.01 * SR)
    if len(seg) <= win:
        return len(seg) // 2
    energy = np.convolve(seg * seg, np.ones(win), "valid")
    return int(np.argmin(energy)) + win // 2


def add_pauses(a, toks):
    words, cuts = [], []
    for i, (text, s, e) in enumerate(toks):
        stripped = text.strip()
        punct_only = stripped and all(ch in EXTRA for ch in stripped)
        if not punct_only:
            words.append([s, e, text])
        tail = stripped[-1:] if stripped else ""
        if tail in EXTRA and i < len(toks) - 1:
            lo, hi = max(0, int((s - 0.02) * SR)), min(len(a), int((e + 0.04) * SR))
            if punct_only:
                at = lo + quietest(a[lo:hi]) if hi > lo else int(e * SR)
            else:                       # punctuation glued to a word ("A."): cut just after it
                lo2, hi2 = int(e * SR), min(len(a), int((e + 0.08) * SR))
                at = lo2 + quietest(a[lo2:hi2]) if hi2 > lo2 else int(e * SR)
            cuts.append((at, int(EXTRA[tail] * SR)))
    if not cuts:
        return a, words
    parts, prev = [], 0
    for at, n in sorted(cuts):
        seg = a[prev:at].copy()
        if len(seg) > FADE:
            seg[-FADE:] *= np.linspace(1, 0, FADE)
        parts += [seg, np.zeros(n, np.float32)]
        prev = at
    rest = a[prev:].copy()
    if len(rest) > FADE:
        rest[:FADE] *= np.linspace(0, 1, FADE)
    parts.append(rest)
    out = np.concatenate(parts)
    for w in words:                     # shift each word by the silence inserted before it
        shift = sum(n for at, n in cuts if at <= int(w[0] * SR) + FADE) / SR
        w[0] += shift
        w[1] += shift
    return out, words


def cuten(a, pitch, formant):
    """Raise the pitch and brighten the tone (younger, cuter), keeping timing unchanged."""
    import parselmouth
    from parselmouth.praat import call
    snd = parselmouth.Sound(a.astype(np.float64), SR)
    median = call(snd.to_pitch(), "Get quantile", 0, 0, 0.5, "Hertz")
    if not median or median != median:
        return a
    out = call(snd, "Change gender", 75, 600, formant, median * pitch, 1.15, 1.0)
    return np.asarray(out.values[0], dtype=np.float32)


def main():
    job = json.load(sys.stdin)
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    voice = voice_of(pipe, job["voice"])
    for n, item in enumerate(job["items"], 1):
        a, toks = synth(pipe, item["text"], voice, job.get("speed", 1.0))
        a, words = add_pauses(a, toks)
        if job.get("cute"):
            a = cuten(a, *job["cute"])
        sf.write(item["out"] + ".wav", a, SR)
        with open(item["out"] + ".json", "w", encoding="utf-8") as f:
            json.dump(words, f)
        if n % 25 == 0:
            print(f"  kokoro: {n}/{len(job['items'])}", flush=True)


if __name__ == "__main__":
    main()
