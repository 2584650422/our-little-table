"""Small COS abstraction for private object storage.

Only object keys are persisted in MySQL.  Read URLs are generated on demand so
the bucket can remain private without putting permanent credentials in the app.
"""
import logging
from typing import Iterable, Optional

from .config import settings

logger = logging.getLogger("little_table.storage")


def configured() -> bool:
    return all((settings.cos_secret_id, settings.cos_secret_key, settings.cos_bucket, settings.cos_region))


def couple_prefix(public_id: str) -> str:
    return f"{settings.cos_key_prefix}/couples/{public_id}/"


def is_couple_key(key: Optional[str], public_id: str) -> bool:
    return bool(key and key.startswith(couple_prefix(public_id)))


def _client():
    from qcloud_cos import CosConfig, CosS3Client
    return CosS3Client(CosConfig(Region=settings.cos_region, SecretId=settings.cos_secret_id,
                                 SecretKey=settings.cos_secret_key, Token=None, Scheme="https"))


def signed_url(key: Optional[str], legacy_url: Optional[str] = None) -> Optional[str]:
    """Return a short-lived URL for a private object, retaining old data safely."""
    if not key:
        return legacy_url or None
    if not configured():
        return legacy_url or None
    try:
        return _client().get_presigned_url(Method="GET", Bucket=settings.cos_bucket, Key=key,
                                           Expired=settings.cos_signed_url_expires_seconds)
    except Exception:
        logger.exception("cos.sign_read_url_failed key=%s", key)
        return None


def delete_keys(keys: Iterable[str]) -> None:
    """Delete known keys one by one; callers only pass keys already scope-checked."""
    if not configured():
        return
    client = _client()
    for key in {key for key in keys if key}:
        try:
            client.delete_object(Bucket=settings.cos_bucket, Key=key)
        except Exception:
            logger.exception("cos.delete_object_failed key=%s", key)
            raise


def delete_prefix(prefix: str) -> int:
    """Remove every object below a single couple prefix, including paginated lists."""
    if not configured():
        return 0
    client, marker, count = _client(), "", 0
    while True:
        response = client.list_objects(Bucket=settings.cos_bucket, Prefix=prefix, Marker=marker)
        keys = [item["Key"] for item in response.get("Contents", [])]
        delete_keys(keys)
        count += len(keys)
        if not response.get("IsTruncated"):
            return count
        marker = response.get("NextMarker") or (keys[-1] if keys else "")
        if not marker:
            raise RuntimeError("COS object listing did not return a continuation marker")
