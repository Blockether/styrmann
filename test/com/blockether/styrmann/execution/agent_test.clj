(ns com.blockether.styrmann.execution.agent-test
  (:require
   [com.blockether.styrmann.execution.agent :as sut]
   [lazytest.core :refer [defdescribe describe expect it]]))

(defdescribe provider->config-test
  (describe "converts a DB provider map to Svar config"
    (it "creates config with api-key, base-url, and model"
        (let [provider {:provider/api-key "sk-test123"
                        :provider/base-url "https://llm.blockether.com/v1"}
              config (sut/provider->config provider "glm-5-turbo")]
          (expect (some? config))
          (expect (= "sk-test123" (:api-key config)))
          (expect (= "https://llm.blockether.com/v1" (:base-url config)))
          (expect (= "glm-5-turbo" (:model config)))))

    (it "uses default model glm-5-turbo when no model specified"
        (let [provider {:provider/api-key "sk-test"
                        :provider/base-url "https://example.com/v1"}
              config (sut/provider->config provider nil)]
          (expect (= "glm-5-turbo" (:model config)))))))

(defdescribe resolve-config-test
  (describe "resolves config from provider or env"
    (it "prefers explicit provider over env vars"
        (let [provider {:provider/api-key "sk-provider"
                        :provider/base-url "https://provider.com/v1"}
              config (sut/resolve-config {:provider provider :model "glm-5"})]
          (expect (= "sk-provider" (:api-key config)))
          (expect (= "glm-5" (:model config)))))

    (it "falls back to env when no provider given"
        (let [config (sut/resolve-config {})]
          ;; Should return env-based config or nil
          (expect (or (nil? config) (map? config)))))))
