---
title: Read a pull request review
section: Projects and shipping
type: how-to
order: 334
summary: Run your Spark or workflow reviewer on a pull request from the GitHub page, follow its state and read its review in the details.
---

You'll run your reviewer on a pull request and read what it wrote. About 2 minutes. First pick a reviewer under [Review with a Spark or workflow](github-page.md#review-with-a-spark-or-workflow).

## Run a review

1. On the **GitHub** page, select a pull request. Its details end with **Review**.
2. Select **Review now**. The state shows **Queued**, then **Reviewing**.
3. Select **Stop** to end it early; the state shows **Stopped**.

With no reviewer picked, a line points to **Auto-review** instead of a button.

## Read it

1. When the state shows **Done**, the review appears as the reviewer wrote it, with any folded sections.
2. **Reviewed an earlier commit** means new commits came since; select **Review again**.
3. If the reviewer posted it, select **View on GitHub** to open it there.

**Failed** shows the error; select **Review again** to retry. In the list, each row shows the latest review, such as **Reviewing** or **Reviewed**.

With **Review automatically** on, a review that could not start is tried again after 10 minutes; one you stopped is not.

**Next:** [Let Spark handle PR feedback](pr-follow-up.md)
