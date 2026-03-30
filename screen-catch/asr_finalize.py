import json
import os
import re
import sys

import dashscope
from dashscope.audio.asr import Recognition


def load_api_key():
    api_key = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if api_key:
        return api_key
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        content = open(env_path, "r", encoding="utf-8").read()
        m = re.search(r"^QWEN_API_KEY=(.*)$", content, flags=re.M)
        if m:
            return m.group(1).strip().strip('"').strip("'")
        m2 = re.search(r"^DASHSCOPE_API_KEY=(.*)$", content, flags=re.M)
        if m2:
            return m2.group(1).strip().strip('"').strip("'")
    return None


def extract_speaker_id(sentence):
    if not isinstance(sentence, dict):
        return None
    for k in ("speaker_id", "speakerId", "spk_id"):
        v = sentence.get(k)
        if v is not None and v != "":
            return v
    words = sentence.get("words")
    if isinstance(words, list):
        counts = {}
        for w in words:
            if not isinstance(w, dict):
                continue
            wid = w.get("speaker_id")
            if wid is None:
                wid = w.get("speakerId")
            if wid is None or wid == "":
                continue
            key = str(wid)
            counts[key] = counts.get(key, 0) + 1
        if counts:
            return max(counts, key=counts.get)
    return None


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing_wav_path"}, ensure_ascii=True))
        return 1
    wav_path = sys.argv[1]
    if not os.path.exists(wav_path):
        print(json.dumps({"ok": False, "error": "wav_not_found"}, ensure_ascii=True))
        return 1

    api_key = load_api_key()
    if not api_key:
        print(json.dumps({"ok": False, "error": "missing_api_key"}, ensure_ascii=True))
        return 1
    dashscope.api_key = api_key

    rec = Recognition(
        model="paraformer-realtime-v2",
        format="wav",
        sample_rate=16000,
        diarization_enabled=True,
        language_hints=["zh", "en"],
        callback=None
    )
    result = rec.call(wav_path)
    try:
        status_code = int(getattr(result, "status_code", 0))
    except Exception:
        status_code = 0
    if status_code != 200:
        message = getattr(result, "message", "finalize_asr_failed")
        print(json.dumps({"ok": False, "error": str(message)}, ensure_ascii=True))
        return 1

    raw_sentences = result.get_sentence()
    if isinstance(raw_sentences, dict):
        raw_sentences = [raw_sentences]
    if not isinstance(raw_sentences, list):
        raw_sentences = []

    sentences = []
    for s in raw_sentences:
        text = s.get("text", "") if isinstance(s, dict) else ""
        if not text:
            continue
        sentences.append(
            {
                "text": text,
                "speakerId": extract_speaker_id(s),
                "beginTime": s.get("begin_time", 0) if isinstance(s, dict) else 0,
                "endTime": s.get("end_time", 0) if isinstance(s, dict) else 0
            }
        )
    print(json.dumps({"ok": True, "sentences": sentences}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
