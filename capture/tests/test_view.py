from memlane_capture.urls import canonicalize
from memlane_capture.witnesses.view import _AVATAR_URL, embed_url


def test_threads_embed_from_resolved_share_link_drops_query():
    final = "https://www.threads.com/@user.c/post/PostCode003?xmt=AQG0kV4X1jl30z&slof=1"
    assert embed_url(canonicalize(final), "threads", "post") == "https://www.threads.com/@user.c/post/PostCode003/embed"


def test_embed_urls():
    assert embed_url("https://www.facebook.com/a/posts/pfbid1", "facebook", "post").startswith(
        "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fa%2Fposts%2Fpfbid1")
    assert "plugins/video.php" in embed_url("https://www.facebook.com/reel/1", "facebook", "video")
    assert embed_url("https://www.instagram.com/reel/ABC", "instagram", "video") == \
        "https://www.instagram.com/reel/ABC/embed/captioned/"
    assert embed_url("https://vnexpress.net/a.html", "web", "article") is None


def test_avatars_are_not_post_media():
    assert _AVATAR_URL.search("https://scontent.cdninstagram.com/v/t51.2885-19/434611453_n.jpg")
    assert _AVATAR_URL.search("https://scontent.fmel19-2.fna.fbcdn.net/v/t39.30808-1/682468421_n.jpg")
    assert not _AVATAR_URL.search("https://instagram.fmel19-2.fna.fbcdn.net/v/t51.82787-15/774665098_n.jpg")
    assert not _AVATAR_URL.search("https://scontent.fmel19-2.fna.fbcdn.net/v/t39.30808-6/515903285_n.jpg")
