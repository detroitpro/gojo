import type { ReactNode } from "react";
import PageHeaderAtlaskit from "@atlaskit/page-header";
import { Box, Flex, xcss } from "@atlaskit/primitives";

const subtitleStyles = xcss({
  color: "color.text.subtlest",
  marginTop: "space.050",
});

export type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <PageHeaderAtlaskit actions={actions ? <>{actions}</> : undefined}>
      {title}
      {subtitle ? (
        <Box as="div" xcss={subtitleStyles}>
          {subtitle}
        </Box>
      ) : null}
    </PageHeaderAtlaskit>
  );
}

export function PageHeaderActions({ children }: { children: ReactNode }) {
  return (
    <Flex gap="space.100" alignItems="center">
      {children}
    </Flex>
  );
}
