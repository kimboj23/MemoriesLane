"""End-to-end: the test UI against the running local Docker stack.

Skipped unless E2E_BASE_URL and E2E_TOKEN are set. Run inside the worker
container (it has Chromium), pointing at the api service:

    docker compose exec -e E2E_BASE_URL=http://api:8700 -e E2E_TOKEN=mlc_... worker \
        python -m pytest tests/e2e -q

It saves real links, so it needs network access and leaves items in the local DB.
"""

import os
import re
import time

import pytest
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("E2E_BASE_URL", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
pytestmark = pytest.mark.skipif(not (BASE and TOKEN), reason="E2E_BASE_URL / E2E_TOKEN not set")

FINAL = re.compile(r"Đã lưu đầy đủ|Lưu được một phần|Bị chặn đăng nhập|Đã bị gỡ|Lỗi")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        yield b
        b.close()


def connect(page, token=TOKEN):
    page.goto(BASE + "/app/")
    page.fill("#token", token)
    page.click("#connect-form button[type=submit]")


def test_security_headers(browser):
    page = browser.new_page()
    resp = page.goto(BASE + "/app/")
    csp = resp.headers.get("content-security-policy", "")
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp


def test_bad_token_is_rejected(browser):
    page = browser.new_page()
    connect(page, "mlc_not-a-real-token")
    expect(page.locator("#connect-error")).to_be_visible()
    expect(page.locator("#save")).to_be_hidden()


def test_save_capture_view_and_new_version(browser):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    connect(page)
    expect(page.locator("#save")).to_be_visible()

    # a fresh, unique URL each run so it is never a duplicate on the first save
    url = f"https://example.com/?e2e={int(time.time())}"
    page.fill("#link", url)
    expect(page.locator("#detected")).to_have_text("Web")
    page.click("#save-btn")
    expect(page.locator("#result")).to_contain_text("Đã gửi vào kho lưu trữ")

    card = page.locator("#items li").filter(has_text="example.com").first
    expect(card).to_be_visible()
    expect(card.locator(".chip")).to_have_text(FINAL, timeout=180_000)

    card.click()
    expect(page.locator("#detail")).to_be_visible()
    # screenshots are fetched with the token as blobs and must actually render
    img = page.locator(".gallery img").first
    expect(img).to_be_visible(timeout=30_000)
    page.wait_for_function("() => [...document.querySelectorAll('.gallery img')].some(i => i.naturalWidth > 0)")
    expect(page.locator(".files")).to_contain_text("Manifest")
    expect(page.locator(".hash")).to_contain_text(re.compile(r"[0-9a-f]{64}"))

    # editing metadata persists
    page.fill("#e-note", "ghi chú e2e")
    page.click("#detail form button[type=submit]")
    expect(page.locator("#e-msg")).to_have_text("Đã lưu.")

    # saving the same link again warns, and offers a new version
    page.click("#back")
    page.fill("#link", url)
    page.click("#save-btn")
    expect(page.locator("#result")).to_contain_text("đã được bạn lưu")
    page.locator("#result button", has_text="Lưu phiên bản mới").click()
    expect(page.locator("#result")).to_contain_text("Đã yêu cầu chụp lại")


def test_phone_width_and_share_prefill(browser):
    ctx = browser.new_context(viewport={"width": 375, "height": 740}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    connect(page)
    expect(page.locator("#save")).to_be_visible()
    # share-target style entry: ?text= from a phone share sheet prefills the sheet
    page.goto(BASE + "/app/?text=" + "Xem bài này https://www.threads.com/@user.b/post/PostCode001")
    expect(page.locator("#link")).to_have_value(re.compile("threads.com"))
    expect(page.locator("#detected")).to_have_text("Threads")
    overflow = page.evaluate("() => document.scrollingElement.scrollWidth - window.innerWidth")
    assert overflow <= 0, f"horizontal scroll at 375px: {overflow}px"
    ctx.close()
