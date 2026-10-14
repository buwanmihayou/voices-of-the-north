import os
from google.cloud import speech

def transcribe_cantonese(audio_file_path: str):
    client = speech.SpeechClient()

    if not os.path.exists(audio_file_path):
        print(f"找不到音頻文件: {audio_file_path}")
        return

    with open(audio_file_path, "rb") as f:
        audio_content = f.read()

    audio = speech.RecognitionAudio(content=audio_content)

    config = speech.RecognitionConfig(
        language_code="yue-Hant-HK",
        enable_word_time_offsets=True,
        enable_word_confidence=True,
    )

    print("正在通過 Google Cloud STT 識別粵語音頻，請稍候...")
    response = client.recognize(config=config, audio=audio)

    if not response.results:
        print("未檢測到有效語音段落。")
        return

    confidence_threshold = 0.75
    marked_transcript = []

    print("\n--- 逐詞識別詳情與置信度 ---")
    for result in response.results:
        alternative = result.alternatives[0]
        print(f"完整句子: {alternative.transcript}")
        print(f"段落總體置信度: {alternative.confidence:.3f}\n")

        for word_info in alternative.words:
            word = word_info.word
            conf = word_info.confidence
            start_sec = word_info.start_time.total_seconds()
            end_sec = word_info.end_time.total_seconds()

            print(f"詞: {word:6s} | 置信度: {conf:.3f} | 時間: {start_sec:.2f}s - {end_sec:.2f}s")

            if conf < confidence_threshold:
                marked_transcript.append(f"[?💥({conf:.1%}): {word}?]")
            else:
                marked_transcript.append(word)

    print("\n--- 標記疑義詞後的轉寫文本 (Threshold < 75%) ---")
    print(" ".join(marked_transcript))

if __name__ == "__main__":
    audio_path = "./Demo Story.wav"
    transcribe_cantonese(audio_path)