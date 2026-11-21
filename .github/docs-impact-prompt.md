You update the Hookline documentation for a product change.

The product change is {{PRODUCT_REF}} in manueldezman/hookline.

Read these files first.
- .docs-impact/pages.json lists the affected docs pages and the product files that caused each match.
- .docs-impact/changed-files.txt lists the changed product files.
- .docs-impact/product.diff contains the product diff.

Edit only the pages listed in pages.json. For each page, change only what the product diff makes wrong. Keep the existing structure, tone, and wording. Do not change front matter unless a product path in depends_on is wrong. Do not edit any other file.

When you finish, stop. Do not run git commands. Do not commit. Do not push. Do not open a pull request. The workflow does that.
