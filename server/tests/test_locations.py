import unittest
from unittest.mock import patch
from app.locations import resolve
from app import life
import test_life


class LocationTests(unittest.TestCase):
    def test_real_city_boundaries_and_municipality_grouping(self):
        for lat, lng, province, city in [
            (30.657, 104.066, '四川省', '成都市'),
            (33.26, 103.92, '四川省', '阿坝藏族羌族自治州'),
            (39.91, 116.41, '北京市', '北京市'),
            (31.23, 121.47, '上海市', '上海市'),
        ]:
            with self.subTest(city=city):
                result = resolve(lat, lng)
                self.assertEqual(result['provinceName'], province)
                self.assertEqual(result['cityName'], city)
        self.assertEqual(resolve(40.75, -74), {})
        self.assertEqual(resolve(None, None), {})


class PhotoOrderingTests(unittest.TestCase):
    setUp = test_life.LifeTests.setUp
    def test_home_uses_photo_record_date_instead_of_upload_order(self):
        with patch.object(life, 'fetch_all', return_value=[]), patch.object(life, 'fetch_one', side_effect=[
            {'name': '我们', 'anniversary': None, 'tagline': '一起'}, None,
        ]) as fetch:
            response = self.client.get('/api/life/summary')
        self.assertEqual(response.status_code, 200)
        self.assertIn('ORDER BY taken_on DESC,id DESC', fetch.call_args.args[0])
        self.assertEqual(fetch.call_args.args[1], (7,))

    def test_deleted_or_foreign_pagination_anchor_does_not_restart_or_leak(self):
        # The generic LifeTests fixture intentionally leaves AppError unhandled.
        with patch.object(life, 'fetch_one', return_value=None) as fetch, patch.object(life, 'fetch_all') as rows:
            with self.assertRaises(test_life.Error) as error:
                self.client.get('/api/life/photos?beforeId=999')
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(fetch.call_args.args[1], (999, 7))
        rows.assert_not_called()
