(ns com.blockether.styrmann.execution.git-ingestion-test
  (:require
   [com.blockether.styrmann.db.organization :as org-db]
   [com.blockether.styrmann.execution.corpus-loader :as corpus-loader]
   [com.blockether.styrmann.execution.git-ingestion :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-conn temp-dir
                                                 with-temp-conn with-temp-dir]]
   [lazytest.core :refer [defdescribe expect it]]))

(defdescribe ingest-repo-history!-test
  (it "ingests mocked corpus commit history from a temporary git repository"
      (with-temp-conn [conn (temp-conn)]
        (with-temp-dir [repo-dir (temp-dir)]
          (let [organization (org-db/create-organization! conn {:name "Blockether"})
                workspace (org-db/create-workspace!
                           conn
                           {:organization-id (:organization/id organization)
                            :name "corpus"
                            :repository repo-dir})
                _ (corpus-loader/init-repo! repo-dir)
                [sha-1 sha-2 sha-3] (corpus-loader/seed-history!
                                     repo-dir
                                     [{:project-name "lein-hello-world"
                                       :message "feat: add lein hello world corpus"}
                                      {:project-name "deps-hello-world"
                                       :message "feat: add deps hello world corpus"}
                                      {:project-name "clj-algorithms"
                                       :message "feat: add advanced clojure algorithms corpus"}])
                result (sut/ingest-repo-history! conn (:workspace/id workspace) repo-dir)
                commits (:commits result)]
            (expect (= 3 (count commits)))
            (expect (= [sha-1 sha-2 sha-3]
                       (mapv :git.commit/sha commits)))
            (expect (= "feat: add lein hello world corpus"
                       (:git.commit/message (first commits))))
            (expect (= (:git.commit/id (second commits))
                       (-> commits last :git.commit/parent first :git.commit/id)))
            (expect (= "main"
                       (-> result :branch :git.branch/name)))
            (expect (= repo-dir
                       (-> result :worktree :git.worktree/path))))))))
