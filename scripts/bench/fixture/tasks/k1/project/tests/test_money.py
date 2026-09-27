import unittest

from ledger.money import format_cents, parse_cents


class MoneyTest(unittest.TestCase):
    def test_format(self):
        self.assertEqual(format_cents(123456), "$1234.56")
        self.assertEqual(format_cents(-50), "-$0.50")

    def test_parse(self):
        self.assertEqual(parse_cents("$1,234.50"), 123450)
        with self.assertRaises(ValueError):
            parse_cents("abc")


if __name__ == "__main__":
    unittest.main()
