import gzip
import json
import unittest
from unittest.mock import Mock, patch

from google.api_core.exceptions import Forbidden, NotFound
import app


class PublishedStatsTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        self.bucket = Mock()
        self.blob = self.bucket.blob.return_value
        self.blob.content_encoding = None
        self.patcher = patch.object(app, 'get_bucket', return_value=self.bucket)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_index_and_every_category_are_proxied_unchanged(self):
        for category in ['index', *app.CATEGORIES]:
            with self.subTest(category=category):
                payload = {'categories': [{'category': 'team_win'}]} if category == 'index' else {
                    'category': category, 'yesterday': {'hit_rate': 0, 'average_difference': -0.25},
                    'all_time': {'hit_rate': None}, 'daily': [],
                }
                self.blob.download_as_bytes.return_value = json.dumps(payload).encode()
                path = '/api/stats/predictions' + ('' if category == 'index' else '/' + category)
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json, payload)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.bucket.blob.assert_called_with(f'stats/predictions/{category}.json')
                self.blob.download_as_bytes.assert_called_with(raw_download=True)

    def test_gzipped_json(self):
        self.blob.download_as_bytes.return_value = gzip.compress(b'{"daily": []}')
        self.assertEqual(self.client.get('/api/stats/predictions/team_win').json, {'daily': []})

    def test_missing_stats(self):
        self.blob.download_as_bytes.side_effect = NotFound('missing')
        response = self.client.get('/api/stats/predictions/team_win')
        self.assertEqual(response.status_code, 404)
        self.assertIn('stats-only workflow', response.json['error'])

    def test_unknown_category_does_not_access_storage(self):
        self.assertEqual(self.client.get('/api/stats/predictions/unknown').status_code, 400)
        self.bucket.blob.assert_not_called()

    def test_invalid_json_and_storage_errors(self):
        self.blob.download_as_bytes.return_value = b'not json'
        self.assertEqual(self.client.get('/api/stats/predictions').status_code, 502)
        self.blob.download_as_bytes.side_effect = Forbidden('private details')
        response = self.client.get('/api/stats/predictions')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('private details', response.json['error'])


if __name__ == '__main__':
    unittest.main()
