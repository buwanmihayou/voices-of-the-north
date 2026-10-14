# Voices of the North (北區之聲)
AI-driven Cantonese oral history transcription & multimodal digital humanities analysis platform.

## Features
- **Accurate Cantonese Speech-to-Text**: Powered by Google Cloud STT (`yue-Hant-HK`) with word-level confidence and timestamps.
- **Audio Seeking**: Instant audio alignment and playback by clicking transcribed tokens.
- **Linguistic Normalization & Q&A**: Translates colloquial Cantonese into standard written Chinese and generates timeline-anchored Q&A cards via Gemini API (with zero-downtime dynamic fallback).
- **Responsible AI**: Embedded Informed Consent Modal prior to recording.
- **Secure Authentication**: Uses Application Default Credentials (ADC); zero API keys committed.

## Quick Start

### 1. Prerequisites
Ensure `ffmpeg` is installed on your system if audio format conversion is required.

### 2. Install Dependencies
```bash
pip install -r requirements.txt