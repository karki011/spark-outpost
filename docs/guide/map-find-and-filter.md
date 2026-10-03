---
title: Find files on the Map
section: Projects and the Map
type: how-to
order: 321
summary: Find a file, filter the Map by area and file kind, light up a chat's changes, and see what breaks if a file changes.
---

You'll find a file on the Map and check what depends on it. About 2 minutes.

## Find a file

1. Select **Find a file** at the top of the Map, or press **/**.
2. Type part of the name or path and pick a result.
3. Select the file for its details and the buttons **Open in chat**, **Focus** and **Copy path**.

## Filter what the Map shows

1. Select a chip under the header to hide or show that kind.
2. **Shift**-click a chip to show only that kind. **Shift**-click it again to bring the group back.

| Group     | Chips                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| **Areas** | **Core**, **Shared**, **Feature**                                                   |
| **Files** | **UI**, **API**, **Data**, **Tests**, **Config**, **Other**                         |
| **Links** | **HTTP API**, **GraphQL**, **Shared packages**, **Env vars** (two or more projects) |

## Light up a chat's changes

1. Select **This chat's changes**. The files the latest chat in this project changed light up.
2. Select **Include dependents** to add the files that import them.

## See what breaks if a file changes

1. Select **Focus** in **Show the map as**.
2. Pick a file: press **/**, or select a suggested busy file.
3. Read **What breaks if I change this?**. It counts the files that depend on this one and names their **Core** areas.
4. Switch from **1 hop** to **2 hops** to look further.

![Focus view showing what breaks if db.ts changes, with its imports and the files that import it](images/map-focus-light.png)

> **Tip:** Agents can ask the same question in any chat with the `spark_map` tool.

**Next:** [Correct the Map's area labels](map-areas.md)
