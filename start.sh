#!/usr/bin/env bash
# Render 배포용 시작 스크립트
# main.py 위치(backend/)로 이동 후 uvicorn 실행
set -e
cd "$(dirname "$0")/backend"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
