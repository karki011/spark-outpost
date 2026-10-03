---
title: The Map
section: Your tools
order: 420
summary: Open a project's Map, see how it builds, and switch between the Tree, Focus, Outline and Sky views.
---

You'll open the Map of a project and pick the view that fits your question. About 2 minutes.

The Map shows how a project's code fits together: its areas, its files and which files import which. Jev labels each area, so you can see what's **Core** at a glance.

## Open the Map

1. Select **Map** in the rail.
2. If you haven't linked a project yet, select **Add a project** and pick a folder.
3. To change which projects show, open the project menu at the top left. Under **Map these projects**, tick one or more. Tick two to see the links between them, such as API calls that meet their routes.

![The Map in the Tree view with the area and file filters](images/map-tree-light.png)

## How the map builds

You don't start a build. Spark maps every linked project in the background, one at a time, and refreshes the map after new commits.

The status at the top right tells you where it is:

- **Updated** _time_: the map is up to date.
- **Waiting**: the build hasn't started yet.
- **Paused**: agents are running. The map picks up when they finish, so it never slows down a chat.
- **Map failed**: point at it to read why.

## Pick a view

Use **Show the map as** at the top to switch views. Each view shows a short tip the first time.

| View        | Shows                                                                                    | Good for                              |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| **Tree**    | Groups of areas as boxes. Select a group to open it.                                     | Getting the shape of a repo.          |
| **Focus**   | One file: what it imports, what imports it, and what could break.                        | Checking a change before you make it. |
| **Outline** | Every group, area and file in one list. Sort by importance, name, size or recent change. | Reading the map with the keyboard.    |
| **Sky**     | The whole map as stars. Brighter stars matter more. Scroll to zoom.                      | An overview of a large repo.          |

The Map opens in **Tree** on a computer and in **Outline** on a phone. It remembers the view you last used.

> **Tip:** In **Tree**, use the arrow keys to move between boxes, **Enter** to open one and **Esc** to close it. Press **F** to focus the selected file.

## Let an agent find code

Agents use the same index the Map is built from. Ask in a chat, for example "Where do we load orders?", and the agent calls `spark_find`. It gets a ranked list of files, each with its area and its main functions and classes with their line numbers, so it reads only those lines.

The list never includes secret files or anything in `.sparkignore`, and it carries no file contents. If the index is still building, the agent is told the result is incomplete.

**Next:** [Find files on the Map](map-find-and-filter.md)
