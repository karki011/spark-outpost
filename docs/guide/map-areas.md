---
title: Map areas and what Jev reads
section: Your tools
order: 422
summary: What Core, Shared and Feature mean, how to correct an area's label, and exactly what Jev reads to name areas.
---

You'll check how the Map labelled your code and fix any label that's wrong. About 2 minutes.

## Areas and categories

An area is a group of related files, such as a folder of auth code. Each area gets one category:

- **Core**: code much of the project depends on. Core areas glow brightest on the map.
- **Shared**: code used across several parts of the project.
- **Feature**: code for one part of the product.

Each label says who set it: **Jev**, **Rules** (Spark's own path and import rules, used when Jev isn't connected or isn't sure) or **You**.

## Correct an area's label

1. Select **Review areas** at the top of the Map. The badge counts the areas to check.
2. Read the list. It starts with the areas Jev is least sure about. **Check this** marks a label Jev is less than 0.70 sure of.
3. For an area that's wrong, pick **Core**, **Shared** or **Feature**. The map redraws as you go.
4. To undo your choice, select **Use Jev's**.

![The Review areas panel listing areas with Jev's label and confidence](images/map-review-light.png)

Your choices are kept for the project and win over Jev's next build.

## What Jev reads

When Jev is connected, it names each area and picks its category. To do that, Jev may read:

- the area's facts, such as its folder and file counts;
- up to 120 file paths in the area, the most important first;
- the contents of the most important files, up to about 6,000 tokens per area and 1,500 per file.

Before anything is sent, Spark redacts keys and tokens in the text. These are never sent:

- secret files, such as `.env` files and keys (see the list in [Protected paths](approvals.md#protected-paths));
- anything that matches your [`.sparkignore`](privacy-and-secrets.md#sparkignore);
- binary files.

Without Jev, Spark's rules label every area, and nothing leaves your computer for the Map.

> **Tip:** A file listed in `.sparkignore` can still show as a dot on the Map, because the map is built from your repo's file list. Its contents are never read or sent.

**Next:** [Spark tools for agents](spark-tools.md)
