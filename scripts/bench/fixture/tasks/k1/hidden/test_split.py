import pathlib
import unittest

from ledger.money import split_cents


class SplitTest(unittest.TestCase):
    def test_even_and_uneven_splits_add_up(self):
        self.assertEqual(split_cents(100, 3), [34, 33, 33])
        self.assertEqual(split_cents(90, 3), [30, 30, 30])
        self.assertEqual(split_cents(1, 4), [1, 0, 0, 0])
        for total in (0, 7, 1001, 99999):
            for parts in (1, 2, 5, 12):
                shares = split_cents(total, parts)
                self.assertEqual(sum(shares), total)
                self.assertEqual(len(shares), parts)
                self.assertLessEqual(max(shares) - min(shares), 1)

    def test_negative_totals_mirror_positive_ones(self):
        self.assertEqual(split_cents(-100, 3), [-33, -33, -34])
        self.assertEqual(sum(split_cents(-7, 2)), -7)

    def test_bad_input_raises(self):
        for args in ((10, 0), (10, -2), (10.5, 2), (10, 2.0)):
            with self.assertRaises(ValueError, msg=str(args)):
                split_cents(*args)

    def test_tests_cover_split_cents(self):
        self.assertIn("split_cents", pathlib.Path("tests/test_money.py").read_text())


if __name__ == "__main__":
    unittest.main()
