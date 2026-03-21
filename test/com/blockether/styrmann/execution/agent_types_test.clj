(ns com.blockether.styrmann.execution.agent-types-test
  (:require
   [com.blockether.styrmann.execution.agent-types :as sut]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.runner.tool-registry :as registry]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe describe expect it]]))

(defdescribe ensure-all-agents!-test
  (describe "registers all 5 agent types"
    (it "creates planner, implementer, reviewer, explorer, verifier agents"
        (with-temp-conn [conn (temp-conn)]
          (registry/register-default-tools!)
          (session/sync-tool-definitions! conn (registry/list-tools))
          (let [agents (sut/ensure-all-agents! conn)]
            (expect (= 5 (count agents)))
            (expect (= #{:agent.type/planner :agent.type/implementer
                          :agent.type/reviewer :agent.type/explorer :agent.type/verifier}
                        (set (map :agent/type agents))))
            (expect (every? some? (map :agent/model agents)))
            (expect (every? some? (map :agent/key agents))))))

    (it "is idempotent — second call returns same agents"
        (with-temp-conn [conn (temp-conn)]
          (registry/register-default-tools!)
          (session/sync-tool-definitions! conn (registry/list-tools))
          (let [first-run (sut/ensure-all-agents! conn)
                second-run (sut/ensure-all-agents! conn)]
            (expect (= (set (map :agent/id first-run))
                        (set (map :agent/id second-run)))))))))

(defdescribe find-agent-by-type-test
  (describe "finds agents by type keyword"
    (it "returns the planner agent"
        (with-temp-conn [conn (temp-conn)]
          (registry/register-default-tools!)
          (session/sync-tool-definitions! conn (registry/list-tools))
          (sut/ensure-all-agents! conn)
          (let [planner (sut/find-agent-by-type conn :agent.type/planner)]
            (expect (= "planner-v1" (:agent/key planner)))
            (expect (= "glm-5" (:agent/model planner)))
            (expect (= :agent.type/planner (:agent/type planner))))))

    (it "rejects invalid agent types"
        (with-temp-conn [conn (temp-conn)]
          (expect (try (sut/find-agent-by-type conn :agent.type/invalid)
                       false
                       (catch Exception _ true)))))))
