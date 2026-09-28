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
