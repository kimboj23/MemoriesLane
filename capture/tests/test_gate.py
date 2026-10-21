"""The gate must never call a wall "complete", which is the old platform's core failure (proposal F1).

Scenarios mirror what the audit observed on 2026-10-18.
"""

from memlane_capture.gate import judge
from memlane_capture.models import ArtifactDraft, WitnessResult


def view(served="", text=None, embed_text=None, author=None, embed_shot=False, images=0, status=200,
         final_url="https://x", login=False, chars=0):
    r = WitnessResult(name="view", ok=True, final_url=final_url)
    r.signals = {"http_status": status, "login_redirect": login}
    r.extracted = {k: v for k, v in {"_served_text": served, "text": text, "embed_text": embed_text,
                                     "author": author, "page_text_chars": chars}.items() if v not in (None, "")}
    r.artifacts.append(ArtifactDraft("screenshot", "context", "as-served", "s.png"))
    if embed_shot:
        r.artifacts.append(ArtifactDraft("screenshot", "primary", "embed", "e.png"))
    for i in range(images):
        r.artifacts.append(ArtifactDraft("image", "primary", "post-image", f"i{i}.jpg"))
    return r


def media(video=False, author=None, text=None, error=None, **signals):
    r = WitnessResult(name="media", ok=video, error=error, signals=signals)
    r.extracted = {k: v for k, v in {"author": author, "text": text}.items() if v}
    if video:
        r.artifacts.append(ArtifactDraft("video", "primary", "video", "v.mp4"))
        r.artifacts.append(ArtifactDraft("image", "context", "thumbnail", "t.jpg"))
    return r


FB_WALL = "Đăng nhập Bạn quên tài khoản ư? See more from Nguyễn Văn A Create new account"
THREADS_WALL = "Say more with Threads Continue with Instagram Log in or sign up for Threads"


def test_facebook_reel_with_video_is_complete():
    v = judge("facebook", "video", {
        "media": media(video=True, author="Trần Thị B", text="Clip thử nghiệm về khu tái định cư"),
        "view": view(served=FB_WALL)})
    assert v.verdict == "complete"


def test_facebook_reel_thumbnail_only_is_not_complete():
    # The old platform linked this thumbnail and called it archived.
    v = judge("facebook", "video", {"media": media(error="Unsupported URL", unsupported=True),
                                     "view": view(served=FB_WALL, login=False)})
    assert v.verdict == "walled"


def test_facebook_post_login_wall_only_is_walled():
    v = judge("facebook", "post", {"media": media(error="registered users", login_required=True),
                                    "view": view(served=FB_WALL)})
    assert v.verdict == "walled"
    assert any("wall" in r for r in v.reasons)


def test_facebook_post_embed_with_truncated_text_is_partial():
    embed = "Nguyễn Văn A\nkhoảng một năm trước\nBài viết thử nghiệm về thông báo thu hồi đất.... Xem thêm"
    v = judge("facebook", "post", {
        "media": media(error="registered users", login_required=True),
        "view": view(served=FB_WALL, text="Bài viết thử nghiệm về thông báo thu hồi đất của phường. Đoạn…",
                     embed_text=embed, author="Nguyễn Văn A", embed_shot=True, images=1)})
    assert v.verdict == "partial"
    assert any("truncated" in r for r in v.reasons)


def test_threads_post_behind_modal_is_complete_from_embed():
    embed = "user.b · Theo dõi\nBài gốc về vụ giải toả hôm qua đã bị xoá rồi, ai còn lưu không\n09:42 · 20-08-2026"
    v = judge("threads", "post", {
        "media": media(error="skipped", skipped=True),
        "view": view(served=THREADS_WALL + " user.b Bài gốc về vụ", text="Bài gốc về vụ giải toả hôm qua đã bị xoá rồi, ai còn lưu không",
                     embed_text=embed, author="@user.b", embed_shot=True)})
    assert v.verdict == "complete"


def test_threads_share_link_to_invalid_post_is_unavailable():
    v = judge("threads", "post", {"media": media(error="skipped", skipped=True),
                                   "view": view(served=THREADS_WALL, final_url="https://www.threads.com/?error=invalid_post")})
    assert v.verdict == "unavailable"


def test_youtube_consent_wall_is_walled():
    v = judge("youtube", "video", {"media": media(error="Sign in to confirm you're not a bot", login_required=True),
                                    "view": view(served="Before you continue to YouTube We use cookies and data")})
    assert v.verdict == "walled"


def test_wall_text_never_counts_as_post_text():
    # og:description on a login page is login copy, not content
    v = judge("facebook", "post", {"view": view(served=FB_WALL, text="Log into Facebook to start sharing and connecting")})
    assert v.verdict == "walled"


def test_news_article_with_login_box_is_still_complete():
    # VN news sites carry their own "Đăng nhập / Quên mật khẩu" box; that is not a wall
    v = judge("web", "article", {"view": view(served="Đăng nhập Quên mật khẩu Thời sự ...", chars=4200)})
    assert v.verdict == "complete"


def test_bot_wall_on_news_article_is_walled():
    v = judge("web", "article", {"view": view(served="Please confirm that you are human. Slide right to secure", chars=60)})
    assert v.verdict == "walled"


def test_dead_page_is_unavailable():
    v = judge("web", "article", {"view": view(served="404 Page not found", status=404, chars=20)})
    assert v.verdict == "unavailable"


def test_wayback_alone_never_makes_complete():
    wb = WitnessResult(name="wayback", ok=True)
    wb.artifacts.append(ArtifactDraft("link", "context", "wayback", source_url="https://web.archive.org/web/1/x"))
    v = judge("facebook", "post", {"view": view(served=FB_WALL), "wayback": wb})
    assert v.verdict == "walled"


def test_facebook_embed_truncation_detected_despite_trailing_counts():
    # Real embed text (2026-10-18): the counts come after "Xem thêm", which hid the truncation
    embed = ("Nguyễn Văn A\nkhoảng một năm trước\n\nBài viết thử nghiệm.\nVề thông báo thu hồi đất của phường.\n\n"
             "Đoạn thứ hai của bài, đủ dài để bị cắt...\n\n...\nXem thêm\n6,5K\n\t\n1,4K\n\t\n445")
    v = judge("facebook", "post", {"view": view(served=FB_WALL, embed_text=embed, author="Nguyễn Văn A",
                                                embed_shot=True, images=1)})
    assert v.verdict == "partial"
    assert v.extracted["text_truncated"] is True


THREADS_RESTRICTED = ("Đăng nhập Nội dung này không hiển thị với tất cả mọi người "
                      "Một số đối tượng không thể xem nội dung này. Xem lý do")
META_LEGAL_NOTICE = ("Cách chúng tôi ra quyết định này. Chúng tôi nhận được yêu cầu pháp lý đề nghị hạn chế nội dung "
                     "này ... đã hạn chế khả năng tiếp cận nội dung này ở quốc gia và vùng lãnh thổ nào xác định "
                     "nội dung này vi phạm luật sở tại.")


def test_threads_legal_restriction_is_restricted_not_complete():
    # Real case 2026-10-18: the embed said "Không có thread" (15 chars) and was mistaken for post text.
    r = view(served=THREADS_RESTRICTED, embed_text="Không có thread", author="@user.d", embed_shot=True)
    r.extracted["restriction_notice"] = META_LEGAL_NOTICE
    v = judge("threads", "post", {"media": media(error="skipped", skipped=True), "view": r})
    assert v.verdict == "restricted"
    assert any("legal request" in x for x in v.reasons)
    assert "yêu cầu pháp lý" in v.extracted["restriction_notice"]


def test_restriction_without_notice_is_still_restricted():
    v = judge("threads", "post", {"view": view(served="This content isn't available to everyone. "
                                                     "It can't be seen by certain audiences. See why")})
    assert v.verdict == "restricted"


def test_platform_notice_is_never_post_text():
    v = judge("threads", "post", {"view": view(served="", text="Không có thread", embed_text="Không có thread",
                                                author="@user.d", embed_shot=True)})
    assert v.verdict != "complete"


def test_http_429_is_rate_limited_not_a_result():
    # Meta answers 429 to datacenter addresses: a blank page, nothing seen. Retry later; never a verdict on the link.
    v = judge("threads", "post", {"view": view(status=429), "media": media(error="HTTP Error 429: Too Many Requests",
                                                                          rate_limited=True)})
    assert v.verdict == "failed" and v.rate_limited and "HTTP 429" in v.reasons[-1]
    v = judge("threads", "post", {"view": view(status=200)})
    assert v.verdict == "failed" and not v.rate_limited


def test_content_beats_a_429_from_one_witness():
    v = judge("threads", "post", {"view": view(text="Nội dung bài viết đủ dài để tính là có chữ.", author="user.b",
                                               embed_shot=True, embed_text="user.b Nội dung bài viết đủ dài để tính là có chữ."),
                                  "media": media(error="HTTP Error 429", rate_limited=True)})
    assert v.verdict in ("complete", "partial") and not v.rate_limited


def test_facebook_logged_out_not_available_is_a_wall_not_a_removal():
    # Seen 2026-10-21: a share link, logged out. Login wall, the embed says the post "may have been removed",
    # yt-dlp gets a 404. Facebook says all this for posts that only need login too.
    notice = "Bài viết này trên Facebook không còn nữa vì có thể đã bị gỡ"
    v = judge("facebook", "post", {"view": view(served=FB_WALL, text=notice, embed_text=notice, embed_shot=True),
                                   "media": media(error="HTTP Error 404: Not Found", unavailable=True)})
    assert v.verdict == "walled" and "may not be removed" in v.reasons[-1]
    assert "text" not in v.extracted                       # the notice is never the post's text
    # No wall served: the platform's own "removed" stands.
    v = judge("facebook", "post", {"view": view(text=notice, embed_text=notice, embed_shot=True)})
    assert v.verdict == "unavailable"


def test_instagram_rate_limit_redirect_is_rate_limited_not_partial():
    # Seen 2026-10-21: the post redirects to /accounts/login/?next=…&is_from_rle, whose og:description is the
    # login page's ("Tạo tài khoản hoặc đăng nhập vào Instagram – …"); yt-dlp says it is a rate limit.
    login = "Tạo tài khoản hoặc đăng nhập vào Instagram – Chia sẻ những gì bạn yêu thích"
    v = judge("instagram", "post", {
        "view": view(text=login, login=True, final_url="https://www.instagram.com/accounts/login/?next=%2Fp%2FPostCode001%2F&is_from_rle"),
        "media": media(error="The webpage request was redirected to the login page. You have exceeded the rate-limit for"
                             " accessing posts anonymously. Use --cookies", rate_limited=True)})
    assert v.verdict == "failed" and v.rate_limited and "text" not in v.extracted
    from memlane_capture.witnesses.media import _classify_error
    assert _classify_error("redirected to the login page. You have exceeded the rate-limit … --cookies") == {"rate_limited": True}


def test_retry_plan():
    from memlane_capture.models import Verdict
    from memlane_capture.worker import retry_plan
    rl, plain, ok = Verdict("failed", [], {}, rate_limited=True), Verdict("failed", [], {}), Verdict("complete", [], {})
    assert retry_plan(ok, 1, 3) == (False, 0, "complete")
    assert [retry_plan(plain, n, 3) for n in (1, 2, 3)] == [(True, 2, "queued"), (True, 4, "queued"), (False, 0, "failed")]
    # 429: long waits, a few more attempts, and the item says why it is waiting
    assert [retry_plan(rl, n, 3)[:2] for n in range(1, 7)] == [(True, 30), (True, 120), (True, 360), (True, 720),
                                                              (True, 720), (False, 0)]
    assert retry_plan(rl, 1, 3)[2] == "rate_limited" and retry_plan(rl, 6, 3)[2] == "failed"
