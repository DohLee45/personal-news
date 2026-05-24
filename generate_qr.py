#!/usr/bin/env python3
"""
generate_qr.py — Personal NEWS 배포 URL QR 코드 생성기

사용법:
    python generate_qr.py                        # 기본 URL 사용
    python generate_qr.py https://your-url.com  # 커스텀 URL

출력: qr.png (프로젝트 루트)
"""

import sys
from pathlib import Path

try:
    import qrcode
    from qrcode.image.styledpil import StyledPilImage
    from qrcode.image.styles.moduledrawers.pil import RoundedModuleDrawer
    STYLED = True
except ImportError:
    import qrcode
    STYLED = False


def generate(url: str, output: str = "qr.png") -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)

    if STYLED:
        img = qr.make_image(
            image_factory=StyledPilImage,
            module_drawer=RoundedModuleDrawer(),
        )
    else:
        img = qr.make_image(fill_color="black", back_color="white")

    img.save(output)
    print(f"✅ QR 코드 생성 완료: {output}")
    print(f"   URL: {url}")


if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else "https://personal-news.onrender.com"
    out_file = Path(__file__).parent / "qr.png"
    generate(target_url, str(out_file))
