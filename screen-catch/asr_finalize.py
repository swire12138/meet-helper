import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import dashscope
from dashscope.audio.asr import Transcription


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


def is_http_url(value):
    return isinstance(value, str) and value.startswith(("http://", "https://"))


def get_data_dir():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))


def build_public_audio_url(local_path):
    public_base = (os.getenv("ASR_AUDIO_PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if not public_base:
        return None
    data_dir = get_data_dir()
    abs_path = os.path.abspath(local_path)
    try:
        rel_path = os.path.relpath(abs_path, data_dir)
    except ValueError:
        return None
    if rel_path.startswith(".."):
        return None
    rel_url = urllib.parse.quote(rel_path.replace("\\", "/"))
    return f"{public_base}/api/asr/files/{rel_url}"


def normalize_audio_source(audio_source):
    if is_http_url(audio_source):
        return audio_source
    if not os.path.exists(audio_source):
        return None
    return build_public_audio_url(audio_source)


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8"))


def extract_transcription_url(payload):
    if not isinstance(payload, dict):
        return None
    output = payload.get("output") or {}
    result = output.get("result")
    if isinstance(result, dict) and result.get("transcription_url"):
        return result.get("transcription_url")
    results = output.get("results")
    if isinstance(results, list):
        for item in results:
            if isinstance(item, dict) and item.get("transcription_url"):
                return item.get("transcription_url")
    return None


def extract_sentences_from_payload(payload):
    if not isinstance(payload, dict):
        return []
    transcripts = payload.get("transcripts")
    if not isinstance(transcripts, list):
        return []
    sentences = []
    for transcript in transcripts:
        if not isinstance(transcript, dict):
            continue
        for s in transcript.get("sentences", []) or []:
            if not isinstance(s, dict):
                continue
            text = s.get("text", "")
            if not text:
                continue
            sentences.append(
                {
                    "text": text,
                    "speakerId": extract_speaker_id(s),
                    "beginTime": s.get("begin_time", 0),
                    "endTime": s.get("end_time", 0),
                }
            )
    return sentences


def response_to_dict(response):
    if isinstance(response, dict):
        return {k: response_to_dict(v) for k, v in response.items()}
    if isinstance(response, list):
        return [response_to_dict(v) for v in response]
    if isinstance(response, (str, int, float, bool)) or response is None:
        return response
    if hasattr(response, "__dict__"):
        return {
            k: response_to_dict(v)
            for k, v in response.__dict__.items()
            if not k.startswith("_")
        }
    return str(response)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing_wav_path"}, ensure_ascii=True))
        return 1
    audio_source = sys.argv[1]
    if not is_http_url(audio_source) and not os.path.exists(audio_source):
        print(json.dumps({"ok": False, "error": "audio_source_not_found"}, ensure_ascii=True))
        return 1

    api_key = load_api_key()
    if not api_key:
        print(json.dumps({"ok": False, "error": "missing_api_key"}, ensure_ascii=True))
        return 1
    dashscope.api_key = api_key

    model = os.getenv("ASR_FINALIZE_MODEL", "paraformer-v2")
    public_audio_url = normalize_audio_source(audio_source)
    if not public_audio_url:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "missing_public_audio_url",
                    "message": "Paraformer file transcription requires a public audio URL. Set ASR_AUDIO_PUBLIC_BASE_URL or pass an https URL.",
                    "model": model,
                },
                ensure_ascii=True,
            )
        )
        return 1

    try:
        task = Transcription.async_call(
            model=model,
            file_urls=[public_audio_url],
            diarization_enabled=True,
            timestamp_alignment_enabled=True,
            language_hints=["zh", "en"],
        )
        result = Transcription.wait(task)
        payload = response_to_dict(result)
        try:
            status_code = int(payload.get("status_code", 0))
        except Exception:
            status_code = 0
        if status_code != 200:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": str(payload.get("message") or payload.get("code") or "finalize_asr_failed"),
                        "model": model,
                        "audioUrl": public_audio_url,
                        "payload": payload,
                    },
                    ensure_ascii=True,
                )
            )
            return 1

        transcription_url = extract_transcription_url(payload)
        if not transcription_url:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "missing_transcription_url",
                        "model": model,
                        "audioUrl": public_audio_url,
                        "payload": payload,
                    },
                    ensure_ascii=True,
                )
            )
            return 1

        result_payload = fetch_json(transcription_url)
        sentences = extract_sentences_from_payload(result_payload)
        print(
            json.dumps(
                {
                    "ok": True,
                    "model": model,
                    "audioUrl": public_audio_url,
                    "transcriptionUrl": transcription_url,
                    "sentences": sentences,
                },
                ensure_ascii=True,
            )
        )
        return 0
    except urllib.error.URLError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "fetch_transcription_result_failed",
                    "message": str(exc),
                    "model": model,
                    "audioUrl": public_audio_url,
                },
                ensure_ascii=True,
            )
        )
        return 1
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "finalize_asr_failed",
                    "message": str(exc),
                    "model": model,
                    "audioUrl": public_audio_url,
                },
                ensure_ascii=True,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
