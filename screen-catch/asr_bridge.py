import json
import os
import sys

import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult


def emit(event):
    sys.stdout.write(json.dumps(event, ensure_ascii=True) + "\n")
    sys.stdout.flush()


class Callback(RecognitionCallback):
    @staticmethod
    def _extract_speaker_id(sentence):
        speaker_id = sentence.get("speaker_id")
        if speaker_id is not None:
            return speaker_id
        speaker_id = sentence.get("speakerId")
        if speaker_id is not None:
            return speaker_id
        speaker_id = sentence.get("spk_id")
        if speaker_id is not None:
            return speaker_id
        words = sentence.get("words")
        if isinstance(words, list):
            counts = {}
            for w in words:
                if not isinstance(w, dict):
                    continue
                wid = w.get("speaker_id")
                if wid is None:
                    wid = w.get("speakerId")
                if wid is None:
                    continue
                key = str(wid)
                counts[key] = counts.get(key, 0) + 1
            if counts:
                return max(counts, key=counts.get)
        return None

    def on_open(self) -> None:
        emit({"type": "ready"})

    def on_complete(self) -> None:
        emit({"type": "completed"})

    def on_error(self, result) -> None:
        message = getattr(result, "message", str(result))
        request_id = getattr(result, "request_id", "")
        emit({"type": "error", "message": message, "request_id": request_id})

    def on_event(self, result: RecognitionResult) -> None:
        sentence = result.get_sentence()
        if not isinstance(sentence, dict):
            return
        text = sentence.get("text", "")
        if not text:
            return
        begin_time = sentence.get("begin_time", 0)
        end_time = sentence.get("end_time", 0)
        emit({"type": "partial", "text": text, "time": end_time})
        if RecognitionResult.is_sentence_end(sentence):
            speaker_id = self._extract_speaker_id(sentence)
            emit({"type": "sentence", "text": text, "speakerId": speaker_id, "time": end_time, "beginTime": begin_time})


def load_api_key():
    api_key = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if api_key:
        return api_key
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k == "QWEN_API_KEY" and v:
                    return v
                if k == "DASHSCOPE_API_KEY" and v:
                    return v
    return None


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    api_key = load_api_key()
    if not api_key:
        emit({"type": "error", "message": "Missing QWEN_API_KEY or DASHSCOPE_API_KEY"})
        return 1
    dashscope.api_key = api_key

    model = os.getenv("ASR_MODEL", "paraformer-realtime-v2")
    fmt = os.getenv("ASR_FORMAT", "pcm")
    sample_rate = int(os.getenv("ASR_SAMPLE_RATE", "16000"))

    recognition = Recognition(
        model=model,
        format=fmt,
        sample_rate=sample_rate,
        language_hints=["zh", "en"],
        diarization_enabled=True,
        semantic_punctuation_enabled=False,
        max_sentence_silence=800,
        punctuation_prediction_enabled=True,
        inverse_text_normalization_enabled=True,
        callback=Callback(),
    )

    recognition.start()
    try:
        while True:
            data = sys.stdin.buffer.read(3200)
            if not data:
                break
            recognition.send_audio_frame(data)
    except Exception as e:
        emit({"type": "error", "message": f"ASR Stream Error: {str(e)}"})
    finally:
        try:
            recognition.stop()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        emit({"type": "error", "message": str(e)})
        raise
