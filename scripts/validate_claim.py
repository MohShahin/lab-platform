#!/usr/bin/env python3
"""
Validates that a PR touching data/papers.json does exactly one allowed thing:
a non-admin adding themself to the 'authors' list of a single paper where
their GitHub username is already present in that paper's 'eligibleAuthors'.

Admins (listed in data/users.json) are exempt and may make any change —
they're the ones who maintain eligibleAuthors in the first place.

Exits 0 (pass) or 1 (fail, with a printed reason) for the workflow to act on.
"""
import json
import sys


def load(path):
    with open(path) as f:
        return json.load(f)


def fail(reason):
    print(f"REJECTED: {reason}")
    sys.exit(1)


def main():
    base_path, head_path, users_path, pr_author = sys.argv[1:5]

    base = load(base_path)["papers"]
    head = load(head_path)["papers"]
    users = load(users_path)["members"]

    username_to_display = {u["githubUsername"]: u["displayName"] for u in users}
    admins = {u["githubUsername"] for u in users if u.get("role") == "admin"}

    if pr_author in admins:
        print(f"PR author {pr_author} is a lab admin — no restrictions apply.")
        sys.exit(0)

    if pr_author not in username_to_display:
        fail(f"{pr_author} is not in data/users.json. Ask an admin to add you first.")

    my_display_name = username_to_display[pr_author]

    base_by_id = {p["id"]: p for p in base}
    head_by_id = {p["id"]: p for p in head}

    if set(base_by_id) != set(head_by_id):
        fail("Papers were added or removed. Only admins may do that.")

    changed_ids = [pid for pid in base_by_id if base_by_id[pid] != head_by_id[pid]]

    if len(changed_ids) != 1:
        fail(f"Expected exactly one changed paper, found {len(changed_ids)}: {changed_ids}")

    pid = changed_ids[0]
    old_p, new_p = base_by_id[pid], head_by_id[pid]

    # Every field except 'authors' must be untouched.
    for key in old_p:
        if key == "authors":
            continue
        if old_p.get(key) != new_p.get(key):
            fail(f"Field '{key}' on paper '{pid}' was changed. Only 'authors' may change, "
                 f"and only to add yourself.")

    old_authors = old_p.get("authors", [])
    new_authors = new_p.get("authors", [])

    if len(new_authors) != len(old_authors) + 1:
        fail("You may only add exactly one name (yourself) to 'authors' per PR.")

    if old_authors != new_authors[:len(old_authors)]:
        fail("Existing authors were reordered or removed. Only appending yourself is allowed.")

    added_name = new_authors[-1]
    if added_name != my_display_name:
        fail(f"The name you added ('{added_name}') doesn't match your registered display "
              f"name ('{my_display_name}'). You can only add yourself.")

    if pr_author not in new_p.get("eligibleAuthors", []):
        fail(f"{pr_author} is not on the eligibleAuthors list for '{pid}'. "
             f"An admin needs to add you there first — this is what stops anyone from "
             f"claiming authorship on a paper they haven't been assigned to.")

    print(f"OK: {pr_author} validly added themself ('{my_display_name}') to '{pid}'.")
    sys.exit(0)


if __name__ == "__main__":
    main()
