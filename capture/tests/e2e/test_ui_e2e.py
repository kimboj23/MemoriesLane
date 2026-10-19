"""End-to-end: the workspace UI against the running local Docker stack.

Skipped unless E2E_BASE_URL and E2E_TOKEN (an editor/admin token) are set. Run inside the worker
container (it has Chromium), pointing at the api service:

    docker compose exec -e E2E_BASE_URL=http://api:8700 -e E2E_TOKEN=mlc_... worker \
        python -m pytest tests/e2e -q

It saves real links (example.com), so it needs network access and leaves data in the local DB.
"""

import os
import random
import re
import string
import time

import pytest
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("E2E_BASE_URL", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
pytestmark = pytest.mark.skipif(not (BASE and TOKEN), reason="E2E_BASE_URL / E2E_TOKEN not set")

FINAL = re.compile(r"Đã lưu đầy đủ|Lưu được một phần|Bị chặn đăng nhập|Bị hạn chế truy cập|Đã bị gỡ|Lỗi")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        yield b
        b.close()


def connect(page, token=TOKEN):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/app/")
    page.fill("#token", token)
    page.click("#connect-btn")
    return errors


def test_security_headers(browser):
    page = browser.new_page()
    resp = page.goto(BASE + "/app/")
    csp = resp.headers.get("content-security-policy", "")
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "frame-src 'self'" in csp


def test_bad_token_is_rejected(browser):
    page = browser.new_page()
    connect(page, "mlc_not-a-real-token")
    expect(page.locator("#connect-error")).to_be_visible()
    expect(page.locator("nav.main")).to_be_hidden()


def test_project_incident_material_feed_and_viewers(browser):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = connect(page)
    expect(page.locator("nav.main")).to_be_visible()

    # 1. Configure a project on its own page (Atlos "Manage"), with a custom select attribute.
    code = "E" + "".join(random.choices(string.ascii_uppercase, k=4))
    page.goto(BASE + "/app/#/projects/new")
    page.locator("label", has_text="Tên").locator("input").fill(f"E2E {code}")
    page.locator("label", has_text="Mã").locator("input").fill(code)
    page.get_by_role("button", name="+ Thêm thuộc tính").click()
    page.get_by_placeholder("Tên thuộc tính").fill("Loại tư liệu")
    page.get_by_placeholder("Các lựa chọn (mỗi dòng một lựa chọn)").fill("Thông báo\nVideo")
    page.get_by_role("button", name="Tạo").click()
    expect(page.locator(".project-bar")).to_contain_text(code)
    page.goto(BASE + "/app/#/projects")
    expect(page.locator(".proj-card", has_text=code)).to_be_visible()

    # 2. New incident (Atlos "New incident"): project from a dropdown, a description, source material.
    page.goto(BASE + "/app/#/new")
    page.locator("label", has_text="Dự án").locator("select").select_option(label=f"{code} · E2E {code}")
    page.locator("label", has_text="Mô tả").locator("textarea").fill("Thông báo thử nghiệm e2e")
    url = f"https://example.com/?e2e={int(time.time())}"
    page.locator("label", has_text="Tư liệu nguồn").locator("textarea").fill(url)
    page.locator("label", has_text="Loại tư liệu").locator("select").select_option("Thông báo")
    page.get_by_role("button", name="Tạo").click()
    expect(page.locator(".inc-head .slug")).to_have_text(f"{code}-1")
    expect(page.locator("dl.attrs")).to_contain_text("Thông báo")
    expect(page.locator(".feed")).to_contain_text("đã tạo vụ việc")
    material = page.locator(".material").first
    expect(material.locator(".chip")).to_have_text(FINAL, timeout=180_000)

    # 3. Update an attribute with a reason; it shows in the feed as old -> new.
    page.locator("dl.attrs dd").first.get_by_role("button", name="Cập nhật").click()
    page.locator(".modal select").select_option("in_progress")
    page.get_by_placeholder("Giải thích thay đổi (không bắt buộc)").fill("Bắt đầu xác minh")
    page.get_by_role("button", name="Đăng cập nhật").click()
    expect(page.locator(".feed")).to_contain_text("Cần làm")
    expect(page.locator(".feed")).to_contain_text("Đang làm")
    expect(page.locator(".feed")).to_contain_text("Bắt đầu xác minh")

    # 4. Comment.
    page.get_by_placeholder("Viết bình luận…").fill("Bình luận e2e")
    page.get_by_role("button", name="Bình luận").click()
    expect(page.locator(".feed .comment-text").last).to_have_text("Bình luận e2e")

    # 5. Item page: every artifact previews in the browser and opens a full viewer.
    material.get_by_role("link", name="Xem →").click()
    expect(page.locator("figure.art").first).to_be_visible()
    page.locator("figure.art", has_text="Toàn trang").first.click()
    page.wait_for_function("() => { const i = document.querySelector('.lb img'); return i && i.naturalWidth > 0; }")
    page.keyboard.press("ArrowRight")
    expect(page.locator(".lb")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator(".lb")).to_have_count(0)
    page.locator("figure.art", has_text="Chữ trên trang").first.click()
    expect(page.locator(".lb-text")).to_contain_text("documentation examples")
    page.keyboard.press("Escape")
    page.locator("figure.art", has_text="HTML trang").first.click()
    frame = page.locator(".lb iframe")
    expect(frame).to_have_attribute("sandbox", "")
    expect(page.frame_locator(".lb iframe").locator("body")).to_contain_text("documentation examples")
    page.keyboard.press("Escape")
    expect(page.locator("figure.art", has_text="Manifest")).to_be_visible()

    # 6. The save dialog ("+ Lưu liên kết" in the bar) files a link under an incident chosen from the dropdowns;
    #    the inbox has no form of its own and refreshes when a link is saved.
    page.goto(BASE + "/app/#/inbox")
    expect(page.locator("#view #save-form")).to_have_count(0)
    page.click("#quick-save")
    sheet = page.locator(".modal #save-form")
    sheet.locator("textarea").first.fill(f"https://example.com/?e2e-inbox={int(time.time())}")
    sheet.locator(".picker select").nth(0).select_option(label=f"{code} · E2E {code}")
    sheet.locator(".picker select").nth(1).select_option(label=f"{code}-1 · Thông báo thử nghiệm e2e")
    sheet.get_by_role("button", name="Lưu").click()
    expect(sheet.locator(".result")).to_contain_text("Đã gửi vào kho lưu trữ")
    page.keyboard.press("Escape")
    expect(page.locator("#items li").first.locator(".badge.inc")).to_contain_text(f"{code}-1")

    assert not errors, errors


def test_phone_width_and_share_prefill(browser):
    ctx = browser.new_context(viewport={"width": 375, "height": 740}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    connect(page)
    expect(page.locator("nav.main")).to_be_visible()
    page.goto(BASE + "/app/#/inbox?text=" + "Xem bài này https://www.threads.com/@user.b/post/PostCode001")
    # A share opens the save dialog, prefilled.
    expect(page.locator(".modal #save-form textarea").first).to_have_value(re.compile("threads.com"))
    expect(page.locator(".modal #save-form .badge").first).to_have_text("Threads")
    page.keyboard.press("Escape")
    for path in ("#/inbox", "#/incidents", "#/projects"):
        page.goto(BASE + "/app/" + path)
        page.wait_for_timeout(800)
        overflow = page.evaluate("() => document.scrollingElement.scrollWidth - window.innerWidth")
        assert overflow <= 0, f"horizontal scroll at 375px on {path}: {overflow}px"
    ctx.close()
