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
