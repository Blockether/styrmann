(ns com.blockether.styrmann.db.git-test
  "Tests for git entity ingestion: repo, author, branch, worktree, commit.
   Uses the first 3 real commits from the styrmann repo as test data."
  (:require
   [com.blockether.styrmann.db.git :as sut]
   [com.blockether.styrmann.db.organization :as org-db]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [datalevin.core :as d]
   [lazytest.core :refer [defdescribe expect it]])
  (:import
   [java.text SimpleDateFormat]
   [java.util TimeZone]))

;; -- Real commit data from `git log --reverse` --------------------------------

(def ^:private iso-fmt
  (doto (SimpleDateFormat. "yyyy-MM-dd'T'HH:mm:ssXXX")
    (.setTimeZone (TimeZone/getTimeZone "UTC"))))

(def ^:private author-data
  {:name  "Michał Kruk"
   :email "michal@blockether.com"})

(def ^:private commit-1
  {:sha         "8bb9fed41ec9d4ab0cd9b95b452d67c68549ca9c"
   :message     "feat: initial project scaffold — deps, schema, domain model, dev tooling, deploy pipeline"
   :authored-at (.parse iso-fmt "2026-03-18T06:11:20+01:00")
   :parent-shas []})

(def ^:private commit-2
  {:sha         "88b227011a9809712f049dab75cc35f2cd62f645"
   :message     "docs(agents): strengthen KNOWLEDGE.md proactive update rule"
   :authored-at (.parse iso-fmt "2026-03-18T06:12:14+01:00")
   :parent-shas ["8bb9fed41ec9d4ab0cd9b95b452d67c68549ca9c"]})

(def ^:private commit-3
  {:sha         "d1ba6b657dc086f93ed71cac7f58fc2bc16c12de"
   :message     "chore: add .cljfmt.edn and enforce formatting via clojure-lsp"
   :authored-at (.parse iso-fmt "2026-03-18T06:29:05+01:00")
   :parent-shas ["88b227011a9809712f049dab75cc35f2cd62f645"]})

;; -- Helpers ------------------------------------------------------------------

(defn- setup-workspace!
  "Create an organization + workspace, return workspace-id."
  [conn]
  (let [org (org-db/create-organization! conn {:name "Blockether"})
        ws  (org-db/create-workspace! conn {:organization-id (:organization/id org)
                                            :name            "styrmann"
                                            :repository      "https://github.com/Blockether/styrmann"})]
    (:workspace/id ws)))

(defn- ingest-commits!
  "Ingest the 3 test commits into a repo. Returns map of
   {:repo repo, :author author, :branch branch, :worktree worktree, :commits [c1 c2 c3]}."
  [conn workspace-id]
  (let [author   (sut/upsert-author! conn author-data)
        repo     (sut/create-repo! conn {:workspace-id   workspace-id
                                         :origin-url     "git@github.com:Blockether/styrmann.git"
                                         :default-branch "main"})
        repo-id  (:git.repo/id repo)
        ;; Commit 1 — root commit (no parents)
        c1       (sut/create-commit! conn {:repo-id     repo-id
                                           :sha         (:sha commit-1)
                                           :message     (:message commit-1)
                                           :author-id   (:git.author/id author)
                                           :authored-at (:authored-at commit-1)})
        ;; Commit 2 — parent is c1
        c2       (sut/create-commit! conn {:repo-id     repo-id
                                           :sha         (:sha commit-2)
                                           :message     (:message commit-2)
                                           :author-id   (:git.author/id author)
                                           :authored-at (:authored-at commit-2)
                                           :parent-ids  [(:git.commit/id c1)]})
        ;; Commit 3 — parent is c2
        c3       (sut/create-commit! conn {:repo-id     repo-id
                                           :sha         (:sha commit-3)
                                           :message     (:message commit-3)
                                           :author-id   (:git.author/id author)
                                           :authored-at (:authored-at commit-3)
                                           :parent-ids  [(:git.commit/id c2)]})
        ;; Branch pointing at head (c3)
        branch   (sut/create-branch! conn {:repo-id repo-id
                                           :name    "main"})
        branch   (sut/update-branch-head! conn (:git.branch/id branch) (:git.commit/id c3))
        ;; Main worktree
        worktree (sut/create-worktree! conn {:repo-id   repo-id
                                             :path      "/home/user/styrmann"
                                             :branch-id (:git.branch/id branch)
                                             :main?     true})]
    {:repo     repo
     :author   author
     :branch   branch
     :worktree worktree
     :commits  [c1 c2 c3]}))

;; -- Tests --------------------------------------------------------------------

(defdescribe author-upsert-test
  (it "creates an author and deduplicates by email on second upsert"
      (with-temp-conn [conn (temp-conn)]
        (let [a1 (sut/upsert-author! conn {:name "Michał Kruk" :email "michal@blockether.com"})
              a2 (sut/upsert-author! conn {:name "Michal K" :email "michal@blockether.com"})]
          (expect (= (:git.author/id a1) (:git.author/id a2)))
          (expect (= "Michal K" (:git.author/name a2)))
          (expect (= "michal@blockether.com" (:git.author/email a2)))))))

(defdescribe repo-creation-test
  (it "creates a repo linked to a workspace"
      (with-temp-conn [conn (temp-conn)]
        (let [ws-id (setup-workspace! conn)
              repo  (sut/create-repo! conn {:workspace-id   ws-id
                                            :origin-url     "git@github.com:Blockether/styrmann.git"
                                            :default-branch "main"})]
          (expect (some? (:git.repo/id repo)))
          (expect (= "git@github.com:Blockether/styrmann.git" (:git.repo/origin-url repo)))
          (expect (= "main" (:git.repo/default-branch repo)))))))

(defdescribe commit-ingestion-test
  (it "ingests 3 commits with correct parent chain and author refs"
      (with-temp-conn [conn (temp-conn)]
        (let [ws-id  (setup-workspace! conn)
              result (ingest-commits! conn ws-id)
              [c1 c2 c3] (:commits result)]
          ;; All 3 commits created
          (expect (= 3 (count (:commits result))))
          ;; SHAs match
          (expect (= (:sha commit-1) (:git.commit/sha c1)))
          (expect (= (:sha commit-2) (:git.commit/sha c2)))
          (expect (= (:sha commit-3) (:git.commit/sha c3)))
          ;; Messages match
          (expect (= (:message commit-1) (:git.commit/message c1)))
          ;; Author ref resolves
          (expect (= "michal@blockether.com"
                     (-> c1 :git.commit/author :git.author/email)))
          ;; Root commit has no parents
          (expect (nil? (:git.commit/parent c1)))
          ;; c2 parent is c1
          (expect (= (:git.commit/id c1)
                     (-> c2 :git.commit/parent first :git.commit/id)))
          ;; c3 parent is c2
          (expect (= (:git.commit/id c2)
                     (-> c3 :git.commit/parent first :git.commit/id)))))))

(defdescribe find-commit-by-sha-test
  (it "looks up a commit by its SHA"
      (with-temp-conn [conn (temp-conn)]
        (let [ws-id  (setup-workspace! conn)
              _      (ingest-commits! conn ws-id)
              found  (sut/find-commit-by-sha conn (:sha commit-2))]
          (expect (= (:sha commit-2) (:git.commit/sha found)))
          (expect (= (:message commit-2) (:git.commit/message found)))))))

(defdescribe list-commits-by-repo-test
  (it "lists commits newest-first"
      (with-temp-conn [conn (temp-conn)]
        (let [ws-id  (setup-workspace! conn)
              result (ingest-commits! conn ws-id)
              listed (sut/list-commits-by-repo conn (:git.repo/id (:repo result)))]
          (expect (= 3 (count listed)))
          ;; Most recent first
          (expect (= (:sha commit-3) (:git.commit/sha (first listed))))
          (expect (= (:sha commit-1) (:git.commit/sha (last listed))))))))

(defdescribe branch-head-test
  (it "branch head points to the tip commit"
      (with-temp-conn [conn (temp-conn)]
        (let [ws-id  (setup-workspace! conn)
              result (ingest-commits! conn ws-id)
              branch (:branch result)
              c3     (last (:commits result))]
          (expect (= "main" (:git.branch/name branch)))
          (expect (= false (:git.branch/remote? branch)))
          (expect (= (:git.commit/id c3)
                     (-> branch :git.branch/head :git.commit/id)))))))

(defdescribe worktree-test
  (it "worktree links to repo and branch"
      (with-temp-conn [conn (temp-conn)]
        (let [ws-id    (setup-workspace! conn)
              result   (ingest-commits! conn ws-id)
              worktree (:worktree result)]
          (expect (= "/home/user/styrmann" (:git.worktree/path worktree)))
          (expect (= true (:git.worktree/main? worktree)))
          (expect (= "main"
                     (-> worktree :git.worktree/branch :git.branch/name)))))))

(defdescribe full-traversal-test
  (it "can traverse workspace -> repo -> branch -> commit -> author via queries"
      (with-temp-conn [conn (temp-conn)]
        (let [ws-id  (setup-workspace! conn)
              _      (ingest-commits! conn ws-id)
              ;; Query: find all commit SHAs for a workspace
              shas   (d/q '[:find [?sha ...]
                            :in $ ?ws-id
                            :where
                            [?ws :workspace/id ?ws-id]
                            [?repo :git.repo/workspace ?ws]
                            [?commit :git.commit/repo ?repo]
                            [?commit :git.commit/sha ?sha]]
                          (d/db conn)
                          ws-id)]
          (expect (= 3 (count shas)))
          (expect (= #{(:sha commit-1) (:sha commit-2) (:sha commit-3)}
                     (set shas)))))))
