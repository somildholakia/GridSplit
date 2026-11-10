import unittest

from security import is_loopback_host_header


class LoopbackHostValidationTests(unittest.TestCase):
    def test_accepts_loopback_hosts_with_optional_ports(self):
        for value in ("127.0.0.1", "127.0.0.1:8765", "localhost:8765", "[::1]:8765"):
            with self.subTest(value=value):
                self.assertTrue(is_loopback_host_header(value))

    def test_rejects_remote_and_ambiguous_hosts(self):
        for value in ("", "example.com", "localhost.evil", "127.0.0.1.evil",
                      "attacker@127.0.0.1:8765", "127.0.0.1/path", "[::1",
                      "127.0.0.1:99999"):
            with self.subTest(value=value):
                self.assertFalse(is_loopback_host_header(value))


if __name__ == "__main__":
    unittest.main()
