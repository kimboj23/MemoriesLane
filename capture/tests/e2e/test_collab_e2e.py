"""End-to-end: collaboration features (Atlos-style access, invites, notifications, map, import, admin, Wayback).

Same setup as test_ui_e2e.py: E2E_BASE_URL + an admin E2E_TOKEN, run inside the worker container.
Two browser contexts play two people: the admin (project owner) and someone invited by link.
"""

import os
import random
import re
import string

import pytest
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("E2E_BASE_URL", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
pytestmark = pytest.mark.skipif(not (BASE and TOKEN), reason="E2E_BASE_URL / E2E_TOKEN not set")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        yield b
        b.close()


def signed_in(browser, token=TOKEN):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/app/")
    page.evaluate("localStorage.setItem('mlc.onboarded', '1')")  # skip the introduction tour
    page.fill("#token", token)
    page.click("#connect-btn")
    expect(page.locator("nav.main")).to_be_visible()
    return ctx, page, errors


def make_project(page, code):
    page.goto(BASE + "/app/#/projects/new")
    page.locator("label", has_text="Tên").locator("input").fill(f"Hợp tác {code}")
    page.locator("label", has_text="Mã").locator("input").fill(code)
    page.get_by_role("button", name="Tạo").click()
    expect(page.locator(".project-bar")).to_contain_text(code)
    return page.url.split("#/projects/")[1].split("?")[0]


def test_invite_roles_notifications(browser):
    code = "C" + "".join(random.choices(string.ascii_uppercase, k=4))
    actx, admin, aerr = signed_in(browser)
    pid = make_project(admin, code)

    # An incident to collaborate on.
    admin.goto(BASE + f"/app/#/new?project={pid}")
    admin.locator("label", has_text="Mô tả").locator("textarea").fill("Vụ việc cần cộng tác")
    admin.get_by_role("button", name="Tạo").click()
    expect(admin.locator(".inc-head .slug")).to_have_text(f"{code}-1")
    incident_url = admin.url
    expect(admin.locator("#follow")).to_have_text("Đang theo dõi ✓")   # creators follow automatically

    # Owner creates a Viewer invite link on the Access tab; it is shown once.
    admin.goto(BASE + f"/app/#/projects/{pid}?tab=access")
    admin.get_by_role("button", name="Tạo liên kết mời").click()
    link = admin.locator(".invite-link .linkbox").inner_text()
    assert "#/invite/" in link

    # Someone with no account opens it, picks a name, gets a token once, and joins.
    gctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    guest = gctx.new_page()
    guest.goto(link.replace("http://api:8700", BASE))
    expect(guest.locator("#view")).to_contain_text("Người xem")
    guest.locator("label", has_text="Tên hiển thị").locator("input").fill("Khách mời E2E")
    guest.get_by_role("button", name="Tạo tài khoản và tham gia").click()
    expect(guest.locator("#new-token")).to_have_text(re.compile(r"^mlc_"))
    guest.get_by_role("button", name="Tiếp tục").click()
    expect(guest.locator("nav.main")).to_be_visible()
    guest.locator(".tour-card").get_by_role("button", name="Bỏ qua").click()   # a newcomer gets the introduction
    expect(guest.get_by_role("link", name="+ Vụ việc mới")).to_have_count(0)   # viewers can't create

    # A viewer can comment; mentioning the owner notifies them.
    guest.goto(incident_url.replace("http://api:8700", BASE))
    expect(guest.get_by_role("button", name="Cập nhật")).to_have_count(0)      # nor edit
    guest.get_by_placeholder("Viết bình luận…").fill("@Audit tester đã xem, cần thêm ảnh")
    guest.get_by_role("button", name="Bình luận").click()
    expect(guest.locator(".feed .comment-text").last).to_contain_text("đã xem")

    admin.goto(BASE + "/app/#/incidents")
    admin.reload()
    expect(admin.locator("#bell-count")).to_be_visible(timeout=10_000)
    admin.click("#bell")
    first = admin.locator(".notif").first
    expect(first).to_contain_text("Khách mời E2E")
    expect(first).to_contain_text("bạn được nhắc đến")
    admin.get_by_role("button", name="Đánh dấu đã đọc tất cả").click()
    expect(admin.locator(".notif.unread")).to_have_count(0)

    # The owner promotes the guest to Editor on the Access tab; the guest can now edit.
    admin.goto(BASE + f"/app/#/projects/{pid}?tab=access")
    row = admin.locator("tr", has_text="Khách mời E2E")
    row.locator("select").select_option("editor")
    expect(admin.locator(".toast").last).to_have_text("Đã lưu.")
    guest.reload()
    expect(guest.get_by_role("button", name="Cập nhật").first).to_be_visible()

    assert not aerr, aerr
    gctx.close()
    actx.close()


def test_import_map_admin_and_wayback(browser):
    code = "M" + "".join(random.choices(string.ascii_uppercase, k=4))
    ctx, page, errors = signed_in(browser)
    pid = make_project(page, code)

    # Bulk import: preview flags the bad row; after fixing, import creates the incidents.
    page.goto(BASE + f"/app/#/projects/{pid}?tab=import")
    box = page.locator("section", has_text="Nhập hàng loạt").locator("textarea")
    box.fill("mô tả,trạng thái,địa điểm,vĩ độ,kinh độ,độ chính xác\n"
             "Điểm A,Cần làm,Hồng Hà,21.04,105.86,locality\nĐiểm B,???,,,,\n")
    page.get_by_role("button", name="Kiểm tra").click()
    expect(page.locator(".row-error")).to_have_count(1)
    expect(page.get_by_text("Hãy sửa các lỗi rồi kiểm tra lại.")).to_be_visible()
    box.fill("mô tả,trạng thái,địa điểm,vĩ độ,kinh độ,độ chính xác\n"
             "Điểm A,Cần làm,Hồng Hà,21.04,105.86,locality\nĐiểm B,Đang làm,Phúc Tân,21.035,105.857,vicinity\n")
    page.get_by_role("button", name="Kiểm tra").click()
    page.get_by_role("button", name="Nhập 2 vụ việc").click()
    expect(page.get_by_text("Đã nhập 2 vụ việc.")).to_be_visible()

    # Map view: one dot per located incident.
    page.goto(BASE + f"/app/#/incidents?project={pid}&display=map")
    expect(page.locator(".leaflet-container")).to_be_visible()
    page.wait_for_function("() => document.querySelectorAll('path.leaflet-interactive').length >= 2")
    page.locator("path.leaflet-interactive").last.click(force=True)
    expect(page.locator(".leaflet-popup")).to_contain_text(code)

    # Incident page mini-map.
    page.locator(".leaflet-popup a").first.click()
    expect(page.locator("#inc-map.leaflet-container")).to_be_visible()

    # Internet Archive: the item page shows the state and lets you request a copy (no IA keys locally -> skipped).
    page.get_by_role("button", name="+ Thêm tư liệu").click()
    page.locator(".modal textarea").fill(f"https://example.com/?wb-e2e={code}")
    page.locator(".modal").get_by_role("button", name="Lưu").click()
    page.locator(".material").first.get_by_role("link", name="Xem →").click()
    expect(page.locator("#wayback")).to_be_visible()
    expect(page.get_by_role("button", name="Gửi lên Internet Archive")).to_be_visible()
    # Never submit for real from a test: Wayback submissions are public and permanent.
    configured = page.evaluate("() => fetch('/v1/config').then((r) => r.json()).then((c) => c.wayback_configured)")
    if not configured:
        page.once("dialog", lambda d: d.accept())   # the "public and permanent" confirmation
        page.get_by_role("button", name="Gửi lên Internet Archive").click()
        expect(page.locator("#wayback")).to_contain_text("Bỏ qua")
        expect(page.locator("#wayback")).to_contain_text("IA_ACCESS_KEY")

    # Admin: add a person; their token is shown once.
    page.goto(BASE + "/app/#/admin")
    # The page renders once its panels have loaded; scope to the people form (sources has its own "Tên"/"Thêm").
    people = page.locator("form.card", has=page.get_by_role("button", name="Thêm", exact=True)).first
    expect(people).to_be_visible()
    people.locator("label", has_text="Tên").first.locator("input").fill(f"Người {code}")
    people.get_by_role("button", name="Thêm", exact=True).click()
    # Slow under load: the capture started just above runs Chromium in this same container.
    expect(page.locator(".notice .linkbox")).to_have_text(re.compile(r"^mlc_"), timeout=20_000)
    expect(page.locator("tr", has_text=f"Người {code}")).to_be_visible()

    assert not errors, errors
    ctx.close()
