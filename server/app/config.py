import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

def _integer(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default

@dataclass(frozen=True)
class Settings:
    environment: str = os.getenv("NODE_ENV", os.getenv("APP_ENV", "development"))
    port: int = _integer("PORT", 3000)
    jwt_secret: str = os.getenv("JWT_SECRET", "development-only-change-me-please")
    jwt_expires_in: str = os.getenv("JWT_EXPIRES_IN", "7d")
    mysql_host: str = os.getenv("MYSQL_HOST", "127.0.0.1")
    mysql_port: int = _integer("MYSQL_PORT", 3306)
    mysql_database: str = os.getenv("MYSQL_DATABASE", "little_table")
    mysql_user: str = os.getenv("MYSQL_USER", "root")
    mysql_password: str = os.getenv("MYSQL_PASSWORD", "")
    # PyMySQL expects seconds; keep the existing environment variable in ms.
    mysql_connect_timeout: int = max(1, _integer("MYSQL_CONNECT_TIMEOUT_MS", 5000) // 1000)
    wechat_app_id: str = os.getenv("WECHAT_APP_ID", "")
    wechat_app_secret: str = os.getenv("WECHAT_APP_SECRET", "")
    wechat_template_id: str = os.getenv("WECHAT_ORDER_TEMPLATE_ID", "")
    wechat_order_page: str = os.getenv("WECHAT_ORDER_PAGE", "pages/orders/orders")
    wechat_meal_key: str = os.getenv("WECHAT_TEMPLATE_MEAL_KEY", "")
    wechat_dish_key: str = os.getenv("WECHAT_TEMPLATE_DISH_KEY", "")
    wechat_message_key: str = os.getenv("WECHAT_TEMPLATE_MESSAGE_KEY", "")
    wechat_date_key: str = os.getenv("WECHAT_TEMPLATE_DATE_KEY", "")
    cos_secret_id: str = os.getenv("COS_SECRET_ID", "")
    cos_secret_key: str = os.getenv("COS_SECRET_KEY", "")
    cos_bucket: str = os.getenv("COS_BUCKET", "")
    cos_region: str = os.getenv("COS_REGION", "")
    cos_base_url: str = os.getenv("COS_BASE_URL", "").rstrip("/")
    cos_upload_max_mb: int = _integer("COS_UPLOAD_MAX_MB", 5)
    cos_key_prefix: str = os.getenv("COS_KEY_PREFIX", "little-table").strip("/") or "little-table"
    cos_signed_url_expires_seconds: int = _integer("COS_SIGNED_URL_EXPIRES_SECONDS", 600)
    dev_login_enabled: bool = os.getenv("DEV_LOGIN_ENABLED", "false").lower() == "true"
    log_level: str = os.getenv("LOG_LEVEL", "info").upper()
    log_format: str = os.getenv("LOG_FORMAT", "pretty")

settings = Settings()
