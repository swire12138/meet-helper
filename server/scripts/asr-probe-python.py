import os
import sys
import requests
import dashscope
from http import HTTPStatus
from dashscope.audio.asr import Recognition

def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def main():
    load_env_file()
    api_key = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        print("ASR_PY_PROBE missing QWEN_API_KEY/DASHSCOPE_API_KEY")
        sys.exit(1)

    dashscope.api_key = api_key

    sample_url = "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav"
    sample_path = os.path.join(os.path.dirname(__file__), "hello_world_female2.wav")

    r = requests.get(sample_url, timeout=30)
    r.raise_for_status()
    with open(sample_path, "wb") as f:
        f.write(r.content)

    recognition = Recognition(
        model="paraformer-realtime-v2",
        format="wav",
        sample_rate=16000,
        language_hints=["zh", "en"],
        callback=None
    )

    result = recognition.call(sample_path)
    if result.status_code == HTTPStatus.OK:
        print("ASR_PY_PROBE_OK", result.get_sentence())
        sys.exit(0)
    else:
        print("ASR_PY_PROBE_FAIL", result.status_code, result.message)
        sys.exit(1)


if __name__ == "__main__":
    main()
