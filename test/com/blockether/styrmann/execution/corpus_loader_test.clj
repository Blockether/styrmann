(ns com.blockether.styrmann.execution.corpus-loader-test
  (:require
   [clojure.java.shell :as sh]
   [clojure.string :as str]
   [com.blockether.styrmann.execution.corpus-loader :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-dir with-temp-dir]]
   [lazytest.core :refer [defdescribe expect it]]))

(defn- git! [repo-path & args]
  (let [result (apply sh/sh "git" "-C" repo-path args)]
    (when-not (zero? (:exit result))
      (throw (ex-info "Git command failed" {:repo-path repo-path :args args :exit (:exit result) :err (:err result)})))
    (str/trim (:out result))))

(defdescribe list-profiles-test
  (it "lists supported corpus history profiles"
      (expect (= [:linear :branch-merge :hotfix-merge :comprehensive-broken :broken-then-fix :fix-regression]
                 (sut/list-profiles)))))

(defdescribe seed-profile-history!-test
  (it "creates linear profile commits"
      (with-temp-dir [repo (temp-dir)]
        (sut/init-repo! repo)
        (let [shas (sut/seed-profile-history! repo :linear)]
          (expect (= 3 (count shas)))
          (expect (= "main" (git! repo "rev-parse" "--abbrev-ref" "HEAD"))))))

  (it "creates branch-merge profile with merge commit"
      (with-temp-dir [repo (temp-dir)]
        (sut/init-repo! repo)
        (let [shas (sut/seed-profile-history! repo :branch-merge)
              merge-sha (last shas)
              parent-line (git! repo "show" "--no-patch" "--pretty=%P" merge-sha)
              parent-count (count (str/split parent-line #" +"))]
          (expect (= 4 (count shas)))
          (expect (= 2 parent-count)))))

  (it "creates hotfix-merge profile with final feature commit"
      (with-temp-dir [repo (temp-dir)]
        (sut/init-repo! repo)
        (let [shas (sut/seed-profile-history! repo :hotfix-merge)
              head-message (git! repo "show" "--no-patch" "--pretty=%s" "HEAD")]
          (expect (= 5 (count shas)))
          (expect (= "feat: add advanced clojure algorithms corpus" head-message)))))

  (it "creates comprehensive-broken profile with broken corpus commit"
      (with-temp-dir [repo (temp-dir)]
        (sut/init-repo! repo)
        (let [shas (sut/seed-profile-history! repo :comprehensive-broken)
              second-message (git! repo "show" "--no-patch" "--pretty=%s" (second shas))]
          (expect (= 3 (count shas)))
          (expect (= "test: add broken clojure examples corpus" second-message)))))

  (it "creates broken-then-fix profile with repair commit"
      (with-temp-dir [repo (temp-dir)]
        (sut/init-repo! repo)
        (let [shas (sut/seed-profile-history! repo :broken-then-fix)
              fix-message (git! repo "show" "--no-patch" "--pretty=%s" (second shas))
              fixed-file (slurp (str repo "/clj-broken-examples/src/broken/syntax_error.clj"))]
          (expect (= 3 (count shas)))
          (expect (= "fix: repair broken clojure examples" fix-message))
          (expect (= "(ns broken.syntax-error)\n\n(defn broken-fn [x]\n  (+ x 1))\n"
                     fixed-file)))))

  (it "creates fix-regression profile with regression after fix"
      (with-temp-dir [repo (temp-dir)]
        (sut/init-repo! repo)
        (let [shas (sut/seed-profile-history! repo :fix-regression)
              third-message (git! repo "show" "--no-patch" "--pretty=%s" (nth shas 2))
              regressed-file (slurp (str repo "/clj-broken-examples/src/broken/logic_error.clj"))]
          (expect (= 4 (count shas)))
          (expect (= "test: reintroduce logic regression" third-message))
          (expect (= true (str/includes? regressed-file "(inc (count xs))")))))))
