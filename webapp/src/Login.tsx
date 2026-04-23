// SPDX-FileCopyrightText: (C) 2023 Jason Ish <jason@codemonkey.net>
// SPDX-License-Identifier: MIT

import { Alert, Button, Form } from "solid-bootstrap";
import {
  createEffect,
  createResource,
  createSignal,
  Show,
  Suspense,
} from "solid-js";
import { createStore } from "solid-js/store";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { LoginOptions } from "./api";
import * as API from "./api";
import { SET_IS_AUTHENTICATED } from "./global";

async function getLoginOptions(): Promise<LoginOptions> {
  let response = await fetch("api/login", {
    method: "get",
  });
  const json = await response.json();
  return json;
}

export const Login = () => {
  const [loginForm, setLoginForm] = createStore({
    username: "",
    password: "",
  });
  const [error, setError] = createSignal(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const [loginOptions] = createResource(getLoginOptions);
  const navigate = useNavigate();

  const doLogin = async (e: any) => {
    e.preventDefault();

    API.login(loginForm.username, loginForm.password)
      .then(() => {
        SET_IS_AUTHENTICATED(true);
        navigate(searchParams.redirectTo || "/inbox");
      })
      .catch((error) => {
        console.log(`Login error: ${error.toString()}`);
        setError(true);
      });
  };

  const isValid = () => {
    return loginForm.username.length > 0 && loginForm.password.length > 0;
  };

  createEffect(async () => {
    let options = loginOptions();
    if (options) {
      let redirectTo = searchParams.redirectTo || "/inbox";
      if (!options.authentication.required) {
        console.log(
          `No authentication required, navigating back to ${redirectTo}`,
        );
        navigate(redirectTo);
      }
    }
  });

  return (
    <>
      <div
        style={{
          "min-height": "100vh",
          "display": "flex",
          "align-items": "center",
          "justify-content": "center",
          "background-color": "#09090b",
        }}
      >
        <div
          style={{
            "width": "100%",
            "max-width": "380px",
            "padding": "0 1rem",
          }}
        >
          {/* Brand */}
          <div style={{ "text-align": "center", "margin-bottom": "2rem" }}>
            <div
              style={{
                "font-size": "1.5rem",
                "font-weight": "700",
                "letter-spacing": "-0.03em",
                "color": "#fafafa",
                "font-family": "'Inter', sans-serif",
              }}
            >
              AdrieMarine
            </div>
            <div
              style={{
                "font-size": "0.8rem",
                "color": "#a1a1aa",
                "margin-top": "0.25rem",
                "font-family": "'Inter', sans-serif",
              }}
            >
              Sign in to your account
            </div>
          </div>

          {/* Card */}
          <div
            style={{
              "background-color": "#18181b",
              "border": "1px solid #27272a",
              "border-radius": "0.75rem",
              "padding": "1.75rem",
            }}
          >
            <Show when={error()}>
              <Alert dismissible variant={"danger"} style={{ "margin-bottom": "1rem" }}>
                Login Failed
              </Alert>
            </Show>

            <Suspense>
              {loginOptions() && (
                <Form onsubmit={doLogin}>
                  <Form.Group>
                    <Form.Label
                      style={{
                        "font-size": "0.8rem",
                        "font-weight": "500",
                        "color": "#a1a1aa",
                        "font-family": "'Inter', sans-serif",
                      }}
                    >
                      Username
                    </Form.Label>
                    <Form.Control
                      type={"text"}
                      spellcheck={false}
                      oninput={(e) =>
                        setLoginForm("username", e.currentTarget.value)
                      }
                      placeholder={"Enter username..."}
                    />
                  </Form.Group>

                  <Form.Group class={"mt-3"}>
                    <Form.Label
                      style={{
                        "font-size": "0.8rem",
                        "font-weight": "500",
                        "color": "#a1a1aa",
                        "font-family": "'Inter', sans-serif",
                      }}
                    >
                      Password
                    </Form.Label>
                    <Form.Control
                      oninput={(e) =>
                        setLoginForm("password", e.currentTarget.value)
                      }
                      type={"password"}
                      placeholder={"Enter password..."}
                    />
                  </Form.Group>

                  <div class={"d-grid mt-4"}>
                    <Button
                      class={""}
                      variant={"primary"}
                      type={"submit"}
                      disabled={!isValid()}
                    >
                      Sign In
                    </Button>
                  </div>
                </Form>
              )}
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
};
