# Changelog

## [1.1.0](https://github.com/anand-testcompare/opencode-palantir/compare/v1.0.0...v1.1.0) (2026-02-06)


### Features

* **docs:** add CLI entry point for manual doc fetching ([d218c16](https://github.com/anand-testcompare/opencode-palantir/commit/d218c16274f7a94b661a89152a3028a540c55c0f))
* **docs:** add Pagefind fetcher with concurrency and retry ([13bd48c](https://github.com/anand-testcompare/opencode-palantir/commit/13bd48cdebb5c558f800e132370bce3b06bb09bf))
* **docs:** add SQLite database layer for raw doc storage ([867eebf](https://github.com/anand-testcompare/opencode-palantir/commit/867eebfe06d63c967a3598c27c5575c34ca3e2d0))
* **docs:** migrate data layer from SQLite to Parquet ([3ddde4e](https://github.com/anand-testcompare/opencode-palantir/commit/3ddde4e62de62c9ee6a9aed31028a43196067735))
* **plugin:** add get_doc_page and list_all_docs opencode tools ([e387ee8](https://github.com/anand-testcompare/opencode-palantir/commit/e387ee88da3acfdf679fd87bc56f7dd9cac3a338))
* **test:** replace template test with Palantir tool validation command ([5fc2507](https://github.com/anand-testcompare/opencode-palantir/commit/5fc25076f2c4cb42fa0e17cf94e6a5645bbee4db))


### Bug Fixes

* **db:** checkpoint WAL before closing to remove temp files ([a76d490](https://github.com/anand-testcompare/opencode-palantir/commit/a76d4902078aa1f8372eae7b175ca4b22be51272))
* **fetch:** correct Pagefind decompression order and update README ([492869d](https://github.com/anand-testcompare/opencode-palantir/commit/492869dc94710294d328a2fcf7cf3212f02cfd73))
* make mise tasks compatible with CI ([e9a1f60](https://github.com/anand-testcompare/opencode-palantir/commit/e9a1f60532003773b3efa96eb9386202fd88f544))
* publish workflow verification step ([8d2808c](https://github.com/anand-testcompare/opencode-palantir/commit/8d2808cc2ce45c19f39b441a0d65dbf50b972eaa))
* tolerate npm eventual consistency after publish ([577af0a](https://github.com/anand-testcompare/opencode-palantir/commit/577af0a4d3cff046aaea9a29075d1b5acf87268d))

## Changelog

All notable changes to this project will be documented here by Release Please.
