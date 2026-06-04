import json
import os
import re
import sys
import tempfile
import urllib.request

import dashscope
from dashscope.audio.asr import Recognition


SPEAKER_KEYS = ("speaker_id", "speakerId", "spk_id")
DEFAULT_SAMPLE_URL = "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav"


def load_api_key():
    api_key = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if api_key:
        return api_key
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
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
    for key in SPEAKER_KEYS:
        value = sentence.get(key)
        if value not in (None, ""):
            return value
    words = sentence.get("words")
    if isinstance(words, list):
        counts = {}
        for word in words:
            if not isinstance(word, dict):
                continue
            for key in SPEAKER_KEYS:
                value = word.get(key)
                if value in (None, ""):
                    continue
                counts[str(value)] = counts.get(str(value), 0) + 1
        if counts:
            return max(counts, key=counts.get)
    return None


def collect_present_keys(sentence):
    if not isinstance(sentence, dict):
        return []
    keys = []
    for key in SPEAKER_KEYS:
        if sentence.get(key) not in (None, ""):
            keys.append(key)
    words = sentence.get("words")
    if isinstance(words, list):
        for key in SPEAKER_KEYS:
            if any(isinstance(word, dict) and word.get(key) not in (None, "") for word in words):
                keys.append(f"words[].{key}")
    return sorted(set(keys))


def summarize_word_speakers(sentence):
    words = sentence.get("words")
    if not isinstance(words, list):
        return {}
    counts = {}
    for word in words:
        if not isinstance(word, dict):
            continue
        value = None
        for key in SPEAKER_KEYS:
            if word.get(key) not in (None, ""):
                value = str(word.get(key))
                break
        if value is None:
            continue
        counts[value] = counts.get(value, 0) + 1
    return counts


def ensure_wav_path():
    if len(sys.argv) >= 2:
        wav_path = sys.argv[1]
        if not os.path.exists(wav_path):
            raise FileNotFoundError(f"wav_not_found: {wav_path}")
        return os.path.abspath(wav_path), False

    fd, wav_path = tempfile.mkstemp(prefix="asr-speaker-debug-", suffix=".wav")
    os.close(fd)
    urllib.request.urlretrieve(DEFAULT_SAMPLE_URL, wav_path)
    return wav_path, True


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    api_key = load_api_key()
    if not api_key:
        print(json.dumps({"ok": False, "error": "missing_api_key"}, ensure_ascii=False))
        return 1

    wav_path = None
    downloaded = False
    try:
        wav_path, downloaded = ensure_wav_path()
        dashscope.api_key = api_key

        recognition = Recognition(
            model=os.getenv("ASR_MODEL", "paraformer-realtime-v2"),
            format="wav",
            sample_rate=16000,
            diarization_enabled=True,
            language_hints=["zh", "en"],
            callback=None
        )
        result = recognition.call(wav_path)

        status_code = int(getattr(result, "status_code", 0) or 0)
        message = getattr(result, "message", "")
        raw_sentences = result.get_sentence()
        if isinstance(raw_sentences, dict):
            raw_sentences = [raw_sentences]
        if not isinstance(raw_sentences, list):
            raw_sentences = []

        speaker_hits = 0
        details = []
        for idx, sentence in enumerate(raw_sentences):
            extracted = extract_speaker_id(sentence)
            if extracted not in (None, ""):
                speaker_hits += 1
            details.append(
                {
                    "index": idx,
                    "text": sentence.get("text", "") if isinstance(sentence, dict) else "",
                    "begin_time": sentence.get("begin_time", 0) if isinstance(sentence, dict) else 0,
                    "end_time": sentence.get("end_time", 0) if isinstance(sentence, dict) else 0,
                    "present_speaker_keys": collect_present_keys(sentence),
                    "extracted_speaker_id": extracted,
                    "word_speaker_counts": summarize_word_speakers(sentence) if isinstance(sentence, dict) else {},
                    "raw_sentence": sentence,
                }
            )

        summary = {
            "ok": status_code == 200,
            "status_code": status_code,
            "message": message,
            "wav_path": wav_path,
            "downloaded_sample": downloaded,
            "model": os.getenv("ASR_MODEL", "paraformer-realtime-v2"),
            "diarization_enabled": True,
            "sentence_count": len(raw_sentences),
            "speaker_hit_count": speaker_hits,
            "all_unknown": len(raw_sentences) > 0 and speaker_hits == 0,
            "details": details,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0 if status_code == 200 else 1
    finally:
        if downloaded and wav_path and os.path.exists(wav_path):
            try:
                os.remove(wav_path)
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
