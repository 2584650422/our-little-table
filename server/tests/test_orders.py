"""订单删除与图片清理的回归测试。

此处验证删除历史订单时，即使关联的饭后记录查询为空，接口仍能正常删除订单，
并对历史图片调用“无其他记录引用时才清理”的逻辑。数据库和 COS 均由 mock 替代。
"""
import unittest
from unittest.mock import patch

from app import main


class OrderDeletionTests(unittest.TestCase):
    def test_delete_handles_empty_review_result_tuple(self):
        with patch.object(main, "fetch_one", return_value={"status": "ready"}), \
             patch.object(main, "fetch_all", side_effect=[[{"imageKey": "dish-key"}], ()]), \
             patch.object(main, "execute") as execute, \
             patch.object(main, "delete_unreferenced_image") as cleanup:
            result = main.delete_order(8, {"coupleId": 1})
        self.assertEqual(result["code"], 0)
        execute.assert_called_once()
        cleanup.assert_called_once_with("dish-key")


if __name__ == "__main__":
    unittest.main()
