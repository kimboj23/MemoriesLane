"""Canonicalisation is the duplicate key: these cases come from real links in the production `archives` table."""

import pytest

from memlane_capture.urls import canonicalize, classify, extract_url, is_login_url, needs_resolution


@pytest.mark.parametrize("raw, expected", [
    # Threads: tracking params (xmt, slof) and the old platform's "#<timestamp>" re-snapshot fragments
    ("https://www.threads.com/@user.d/post/PostCode002?xmt=AQG0V21ZOs&slof=1#2026-09-04T12:02:25+00:00",
     "https://www.threads.com/@user.d/post/PostCode002"),
    ("https://threads.net/@user.b/post/PostCode001/", "https://www.threads.com/@user.b/post/PostCode001"),
    # Facebook: host variants collapse, share tracking dropped, content ids kept
    ("https://m.facebook.com/person.a/posts/pfbid0EX?mibextid=wwXIfr&rdid=x59&__cft__[0]=AZ",
     "https://www.facebook.com/person.a/posts/pfbid0EX"),
    ("https://www.facebook.com/reel/900000000000009/?fs=e&mibextid=wwXIfr",
     "https://www.facebook.com/reel/900000000000009"),
    ("https://www.facebook.com/photo/?fbid=1646726009098072&set=pcb.1646726145764725&__tn__=*bH-R",
     "https://www.facebook.com/photo?fbid=1646726009098072&set=pcb.1646726145764725"),
    ("https://www.facebook.com/permalink.php?story_fbid=123&id=456&ref=embed_post",
     "https://www.facebook.com/permalink.php?story_fbid=123&id=456"),
    # Facebook outbound-link wrapper and login redirect are unwrapped
    ("https://l.facebook.com/l.php?u=https%3A%2F%2Fvnexpress.net%2Fbai-viet-123.html%3Futm_source%3Dfb&h=AT0",
     "https://vnexpress.net/bai-viet-123.html"),
    ("https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fgroups%2F1158%2Fposts%2F1720%2F",
     "https://www.facebook.com/groups/1158/posts/1720"),
    # YouTube: every form of the same video is one key
    ("https://youtu.be/jSc5Dn8Z1xQ?si=abc", "https://www.youtube.com/watch?v=jSc5Dn8Z1xQ"),
    ("https://www.youtube.com/shorts/jSc5Dn8Z1xQ?feature=share", "https://www.youtube.com/watch?v=jSc5Dn8Z1xQ"),
    ("https://m.youtube.com/watch?v=jSc5Dn8Z1xQ&t=42s&ab_channel=X", "https://www.youtube.com/watch?v=jSc5Dn8Z1xQ"),
    # Instagram
    ("https://www.instagram.com/reels/DZWmzjOILRo/?igsh=MTc4", "https://www.instagram.com/reel/DZWmzjOILRo"),
    ("https://instagram.com/amnestyindonesia/p/DZWmzjOILRo/", "https://www.instagram.com/p/DZWmzjOILRo"),
    # X
    ("https://twitter.com/user/status/1790000000000000000?s=20&t=abc", "https://x.com/user/status/1790000000000000000"),
    # Ordinary sites: only tracking removed, real parameters kept, www kept
    ("http://www.example.gov.vn/tin-tuc?id=12&utm_campaign=x&fbclid=Iw#top", "https://www.example.gov.vn/tin-tuc?id=12"),
    ("https://blog.example.org/?s=thu+hoi+dat", "https://blog.example.org/?s=thu+hoi+dat"),
])
def test_canonicalize(raw, expected):
    assert canonicalize(raw) == expected


def test_canonicalize_is_idempotent():
    for url in ("https://www.threads.com/@a/post/B?xmt=1", "https://youtu.be/x1", "https://vnexpress.net/a.html?utm_x=1"):
        once = canonicalize(url)
        assert canonicalize(once) == once


@pytest.mark.parametrize("text, expected", [
    ("Xem bài viết của Nguyễn Văn A: https://www.facebook.com/share/p/GhIjKl5678/ trên Facebook",
     "https://www.facebook.com/share/p/GhIjKl5678/"),
    ("https://www.threads.com/@a/post/B.", "https://www.threads.com/@a/post/B"),
    ("(link: https://en.wikipedia.org/wiki/Foo_(bar))", "https://en.wikipedia.org/wiki/Foo_(bar)"),
    ("no link here", None),
])
def test_extract_url(text, expected):
    assert extract_url(text) == expected


@pytest.mark.parametrize("url, platform, kind", [
    ("https://www.facebook.com/reel/900000000000009", "facebook", "video"),
    ("https://www.facebook.com/share/r/AbCdEf1234", "facebook", "video"),
    ("https://www.facebook.com/share/p/GhIjKl5678", "facebook", "post"),
    ("https://www.facebook.com/person.a/posts/pfbid0EX", "facebook", "post"),
    ("https://www.facebook.com/groups/100000000000001/posts/200000000000002", "facebook", "post"),
    ("https://www.facebook.com/photo?fbid=1&set=pcb.2", "facebook", "photo"),
    ("https://www.facebook.com/luatkhoa.org", "facebook", "page"),
    ("https://www.threads.com/@user.b/post/PostCode001", "threads", "post"),
    ("https://www.threads.com/share/ShareCode01", "threads", "post"),
    ("https://www.instagram.com/reel/DZWmzjOILRo", "instagram", "video"),
    ("https://www.youtube.com/watch?v=jSc5Dn8Z1xQ", "youtube", "video"),
    ("https://x.com/user/status/1", "x", "post"),
    ("https://vanban.chinhphu.vn/files/QD-123.pdf", "document", "document"),
    ("https://vnexpress.net/bai-viet-123.html", "web", "article"),
])
def test_classify(url, platform, kind):
    c = classify(url)
    assert (c.platform, c.kind) == (platform, kind)


@pytest.mark.parametrize("url, expected", [
    ("https://www.facebook.com/share/p/GhIjKl5678", True),
    ("https://www.threads.com/share/ShareCode01", True),
    ("https://fb.watch/abc", True),
    ("https://vt.tiktok.com/ZS123", True),
    ("https://www.facebook.com/reel/900000000000009", False),
    ("https://www.threads.com/@a/post/B", False),
])
def test_needs_resolution(url, expected):
    assert needs_resolution(canonicalize(url)) is expected


def test_login_urls():
    assert is_login_url("https://www.facebook.com/login/?next=x")
    assert is_login_url("https://www.instagram.com/accounts/login/")
    assert is_login_url("https://consent.youtube.com/m?continue=x")
    assert not is_login_url("https://www.facebook.com/reel/1")
