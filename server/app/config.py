"""读取后端运行配置。

配置从环境变量（本地通常放在 server/.env）读取，并在模块加载时形成
不可变的 Settings 实例。密钥只留在后端进程里，不能返回给小程序或提交到 Git。
"""
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

def _integer(name: str, default: int) -> int:
    """读取整数环境变量；配置写错时使用默认值，避免服务启动阶段崩溃。"""
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default

@dataclass(frozen=True)
class Settings:
    """集中保存 API、数据库、微信订阅消息和 COS 所需的配置项。"""
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
    wechat_served_template_id: str = os.getenv("WECHAT_SERVED_TEMPLATE_ID", "")
    wechat_order_page: str = os.getenv("WECHAT_ORDER_PAGE", "pages/order-detail/order-detail")
    wechat_template_user_key: str = os.getenv("WECHAT_TEMPLATE_USER_KEY", "")
    wechat_dish_key: str = os.getenv("WECHAT_TEMPLATE_DISH_KEY", "")
    wechat_message_key: str = os.getenv("WECHAT_TEMPLATE_MESSAGE_KEY", "")
    wechat_served_user_key: str = os.getenv("WECHAT_SERVED_USER_KEY", "")
    wechat_served_dish_name_key: str = os.getenv("WECHAT_SERVED_DISH_NAME_KEY", "")
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

# 业务代码统一引用这一份配置，避免在各模块重复读取环境变量。
settings = Settings()
