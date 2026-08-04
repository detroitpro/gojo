// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import { Play } from "lucide-vue-next";

import AppButton from "@/ui/AppButton.vue";

describe("AppButton", () => {
  test("renders icon, label, and primary variant", () => {
    const wrapper = mount(AppButton, {
      props: { variant: "primary", icon: Play },
      slots: { default: "Run now" },
    });
    expect(wrapper.classes()).toContain("btn-primary");
    expect(wrapper.text()).toContain("Run now");
    expect(wrapper.find("svg").exists()).toBe(true);
    wrapper.unmount();
  });

  test("shows loading label and disables while busy", async () => {
    const wrapper = mount(AppButton, {
      props: {
        icon: Play,
        loading: true,
        loadingLabel: "Running…",
      },
      slots: { default: "Run now" },
    });
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Running…");
    expect(wrapper.text()).not.toContain("Run now");
    wrapper.unmount();
  });
});
