// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, test } from "vitest";

import PageHeader from "@/ui/PageHeader.vue";

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/agents", name: "agents", component: { template: "<div />" } },
    ],
  });
}

function mountHeader(options: Parameters<typeof mount>[1] = {}) {
  return mount(PageHeader, {
    global: { plugins: [router()] },
    ...options,
  });
}

describe("PageHeader", () => {
  test("renders title and subtitle from props inside the shared chrome", () => {
    const wrapper = mountHeader({
      props: { title: "Agents", subtitle: "Manifest-synced agents" },
    });
    const header = wrapper.find("header.page-header");
    expect(header.exists()).toBe(true);
    expect(wrapper.find("h1").text()).toBe("Agents");
    expect(wrapper.find(".subtitle").text()).toBe("Manifest-synced agents");
    wrapper.unmount();
  });

  test("omits the subtitle and back link when not provided", () => {
    const wrapper = mountHeader({ props: { title: "Settings" } });
    expect(wrapper.find(".subtitle").exists()).toBe(false);
    expect(wrapper.find(".page-header__back").exists()).toBe(false);
    expect(wrapper.find("h1").classes()).not.toContain("mt-2");
    wrapper.unmount();
  });

  test("renders a back link (with label) above an offset title", () => {
    const wrapper = mountHeader({
      props: { title: "Agent", backTo: { name: "agents" }, backLabel: "Agents" },
    });
    const back = wrapper.find(".page-header__back");
    expect(back.exists()).toBe(true);
    expect(back.text()).toContain("Agents");
    expect(wrapper.find("h1").classes()).toContain("mt-2");
    wrapper.unmount();
  });

  test("defaults the back label to 'Back'", () => {
    const wrapper = mountHeader({ props: { title: "Run", backTo: "/" } });
    expect(wrapper.find(".page-header__back").text()).toContain("Back");
    wrapper.unmount();
  });

  test("renders the actions slot inside a toolbar", () => {
    const wrapper = mountHeader({
      props: { title: "Projects" },
      slots: { actions: '<button class="probe">Add</button>' },
    });
    const toolbar = wrapper.find(".toolbar");
    expect(toolbar.exists()).toBe(true);
    expect(toolbar.find("button.probe").exists()).toBe(true);
    wrapper.unmount();
  });

  test("does not render a toolbar when no actions slot is given", () => {
    const wrapper = mountHeader({ props: { title: "Impact" } });
    expect(wrapper.find(".toolbar").exists()).toBe(false);
    wrapper.unmount();
  });

  test("lets the subtitle slot override the subtitle prop", () => {
    const wrapper = mountHeader({
      props: { title: "Runs", subtitle: "ignored" },
      slots: { subtitle: '<div class="subtitle custom">Execution history</div>' },
    });
    expect(wrapper.find(".subtitle.custom").text()).toBe("Execution history");
    expect(wrapper.text()).not.toContain("ignored");
    wrapper.unmount();
  });
});
