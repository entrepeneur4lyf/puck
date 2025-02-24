import {
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  UiState,
  IframeConfig,
  OnAction,
  Overrides,
  Permissions,
  Plugin,
  InitialHistory,
  UserGenerics,
  Config,
  Data,
  Metadata,
} from "../../types";
import { Button } from "../Button";

import { SidebarSection } from "../SidebarSection";
import {
  ChevronDown,
  ChevronUp,
  Globe,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { Heading } from "../Heading";
import { IconButton } from "../IconButton/IconButton";
import { PuckAction } from "../../reducer";
import getClassNameFactory from "../../lib/get-class-name-factory";
import {
  defaultAppState,
  getAppStore,
  useAppStore,
} from "../../stores/app-store";
import { MenuBar } from "../MenuBar";
import styles from "./styles.module.css";
import { Fields } from "./components/Fields";
import { Components } from "./components/Components";
import { Preview } from "./components/Preview";
import { Outline } from "./components/Outline";
import { useRegisterHistoryStore } from "../../stores/history-store";
import { Canvas } from "./components/Canvas";
import { defaultViewports } from "../ViewportControls/default-viewports";
import { Viewports } from "../../types";
import { DragDropContext } from "../DragDropContext";
import { useLoadedOverrides } from "../../lib/use-loaded-overrides";
import { DefaultOverride } from "../DefaultOverride";
import { useInjectGlobalCss } from "../../lib/use-inject-css";
import { usePreviewModeHotkeys } from "../../lib/use-preview-mode-hotkeys";
import { useRegisterNodeStore } from "../../stores/node-store";
import { useRegisterPermissionsStore } from "../../stores/permissions-store";
import { monitorHotkeys, useMonitorHotkeys } from "../../lib/use-hotkey";
import { getFrame } from "../../lib/get-frame";

const getClassName = getClassNameFactory("Puck", styles);
const getLayoutClassName = getClassNameFactory("PuckLayout", styles);

const FieldSideBar = () => {
  const title = useAppStore((s) =>
    s.selectedItem
      ? s.config.components[s.selectedItem.type]?.["label"] ??
        s.selectedItem.type.toString()
      : "Page"
  );

  return (
    <SidebarSection noPadding noBorderTop showBreadcrumbs title={title}>
      <Fields />
    </SidebarSection>
  );
};

export function Puck<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
>({
  children,
  config,
  data: initialData,
  ui: initialUi,
  onChange,
  onPublish,
  onAction,
  permissions = {},
  plugins,
  overrides,
  renderHeader,
  renderHeaderActions,
  headerTitle,
  headerPath,
  viewports = defaultViewports,
  iframe: _iframe,
  dnd,
  initialHistory: _initialHistory,
  metadata,
}: {
  children?: ReactNode;
  config: UserConfig;
  data: Partial<G["UserData"] | Data>;
  ui?: Partial<UiState>;
  onChange?: (data: G["UserData"]) => void;
  onPublish?: (data: G["UserData"]) => void;
  onAction?: OnAction<G["UserData"]>;
  permissions?: Partial<Permissions>;
  plugins?: Plugin[];
  overrides?: Partial<Overrides>;
  renderHeader?: (props: {
    children: ReactNode;
    dispatch: (action: PuckAction) => void;
    state: G["UserAppState"];
  }) => ReactElement;
  renderHeaderActions?: (props: {
    state: G["UserAppState"];
    dispatch: (action: PuckAction) => void;
  }) => ReactElement;
  headerTitle?: string;
  headerPath?: string;
  viewports?: Viewports;
  iframe?: IframeConfig;
  dnd?: {
    disableAutoScroll?: boolean;
  };
  initialHistory?: InitialHistory;
  metadata?: Metadata;
}) {
  const iframe: IframeConfig = {
    enabled: true,
    waitForStyles: true,
    ..._iframe,
  };

  useInjectGlobalCss(iframe.enabled);

  const [generatedAppState] = useState<G["UserAppState"]>(() => {
    const initial = { ...defaultAppState.ui, ...initialUi };

    let clientUiState: Partial<G["UserAppState"]["ui"]> = {};

    if (typeof window !== "undefined") {
      // Hide side bars on mobile
      if (window.matchMedia("(max-width: 638px)").matches) {
        clientUiState = {
          ...clientUiState,
          leftSideBarVisible: false,
          rightSideBarVisible: false,
        };
      }

      const viewportWidth = window.innerWidth;

      const viewportDifferences = Object.entries(viewports)
        .map(([key, value]) => ({
          key,
          diff: Math.abs(viewportWidth - value.width),
        }))
        .sort((a, b) => (a.diff > b.diff ? 1 : -1));

      const closestViewport = viewportDifferences[0].key as any;

      if (iframe.enabled) {
        clientUiState = {
          ...clientUiState,
          viewports: {
            ...initial.viewports,

            current: {
              ...initial.viewports.current,
              height:
                initialUi?.viewports?.current?.height ||
                viewports[closestViewport]?.height ||
                "auto",
              width:
                initialUi?.viewports?.current?.width ||
                viewports[closestViewport]?.width,
            },
          },
        };
      }
    }

    // DEPRECATED
    if (
      Object.keys(initialData?.root || {}).length > 0 &&
      !initialData?.root?.props
    ) {
      console.error(
        "Warning: Defining props on `root` is deprecated. Please use `root.props`, or republish this page to migrate automatically."
      );
    }

    // Deprecated
    const rootProps = initialData?.root?.props || initialData?.root || {};

    const defaultedRootProps = {
      ...config.root?.defaultProps,
      ...rootProps,
    };

    return {
      ...defaultAppState,
      data: {
        ...initialData,
        root: { ...initialData?.root, props: defaultedRootProps },
        content: initialData.content || [],
      },
      ui: {
        ...initial,
        ...clientUiState,
        // Store categories under componentList on state to allow render functions and plugins to modify
        componentList: config.categories
          ? Object.entries(config.categories).reduce(
              (acc, [categoryName, category]) => {
                return {
                  ...acc,
                  [categoryName]: {
                    title: category.title,
                    components: category.components,
                    expanded: category.defaultExpanded,
                    visible: category.visible,
                  },
                };
              },
              {}
            )
          : {},
      },
    } as G["UserAppState"];
  });

  const { appendData = true } = _initialHistory || {};

  const blendedHistories = [
    ...(_initialHistory?.histories || []),
    ...(appendData ? [{ state: generatedAppState }] : []),
  ].map((history) => ({
    ...history,
    // Inject default data to enable partial history injections
    state: { ...generatedAppState, ...history.state },
  }));
  const initialHistoryIndex =
    _initialHistory?.index || blendedHistories.length - 1;
  const initialAppState = blendedHistories[initialHistoryIndex].state;

  useRegisterHistoryStore({
    histories: blendedHistories,
    index: initialHistoryIndex,
    initialAppState,
  });

  const dispatch = useAppStore((s) => s.dispatch);

  const leftSideBarVisible = useAppStore((s) => s.state.ui.leftSideBarVisible);
  const rightSideBarVisible = useAppStore(
    (s) => s.state.ui.rightSideBarVisible
  );

  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // TODO use selector
    useAppStore.subscribe((s) => {
      if (onChange) onChange(s.state.data as G["UserData"]);
    });
  }, []);

  // DEPRECATED
  const rootProps = useAppStore(
    (s) => s.state.data.root.props || s.state.data.root.props
  );

  const toggleSidebars = useCallback(
    (sidebar: "left" | "right") => {
      const widerViewport = window.matchMedia("(min-width: 638px)").matches;
      const sideBarVisible =
        sidebar === "left" ? leftSideBarVisible : rightSideBarVisible;
      const oppositeSideBar =
        sidebar === "left" ? "rightSideBarVisible" : "leftSideBarVisible";

      dispatch({
        type: "setUi",
        ui: {
          [`${sidebar}SideBarVisible`]: !sideBarVisible,
          ...(!widerViewport ? { [oppositeSideBar]: false } : {}),
        },
      });
    },
    [dispatch, leftSideBarVisible, rightSideBarVisible]
  );

  useEffect(() => {
    if (!window.matchMedia("(min-width: 638px)").matches) {
      dispatch({
        type: "setUi",
        ui: {
          leftSideBarVisible: false,
          rightSideBarVisible: false,
        },
      });
    }

    const handleResize = () => {
      if (!window.matchMedia("(min-width: 638px)").matches) {
        dispatch({
          type: "setUi",
          ui: (ui: UiState) => ({
            ...ui,
            ...(ui.rightSideBarVisible ? { leftSideBarVisible: false } : {}),
          }),
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // DEPRECATED
  const defaultHeaderRender = useMemo((): Overrides["header"] => {
    if (renderHeader) {
      console.warn(
        "`renderHeader` is deprecated. Please use `overrides.header` and the `usePuck` hook instead"
      );

      const RenderHeader = ({ actions, ...props }: any) => {
        const Comp = renderHeader!;

        const appState = useAppStore((s) => s.state);

        return (
          <Comp {...props} dispatch={dispatch} state={appState}>
            {actions}
          </Comp>
        );
      };

      return RenderHeader;
    }

    return DefaultOverride;
  }, [renderHeader]);

  // DEPRECATED
  const defaultHeaderActionsRender = useMemo((): Overrides["headerActions"] => {
    if (renderHeaderActions) {
      console.warn(
        "`renderHeaderActions` is deprecated. Please use `overrides.headerActions` and the `usePuck` hook instead."
      );

      const RenderHeader = (props: any) => {
        const Comp = renderHeaderActions!;

        const appState = useAppStore((s) => s.state);

        return <Comp {...props} dispatch={dispatch} state={appState}></Comp>;
      };

      return RenderHeader;
    }

    return DefaultOverride;
  }, [renderHeader]);

  // Load all plugins into the overrides
  const loadedOverrides = useLoadedOverrides({
    overrides: overrides,
    plugins: plugins,
  });

  const CustomPuck = useMemo(
    () => loadedOverrides.puck || DefaultOverride,
    [loadedOverrides]
  );

  const CustomHeader = useMemo(
    () => loadedOverrides.header || defaultHeaderRender,
    [loadedOverrides]
  );
  const CustomHeaderActions = useMemo(
    () => loadedOverrides.headerActions || defaultHeaderActionsRender,
    [loadedOverrides]
  );

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    useAppStore.setState({
      state: initialAppState,
      config,
      plugins: plugins || [],
      overrides: loadedOverrides,
      viewports,
      iframe,
    });
  }, []);

  useRegisterNodeStore();

  useRegisterPermissionsStore(permissions);

  const ready = useAppStore((s) => s.status === "READY");

  useMonitorHotkeys();

  useEffect(() => {
    if (ready && iframe.enabled) {
      const frameDoc = getFrame();

      if (frameDoc) {
        return monitorHotkeys(frameDoc);
      }
    }
  }, [ready, iframe.enabled]);

  usePreviewModeHotkeys();

  useEffect(() => {
    const { state, resolveData } = getAppStore();

    resolveData(state);
  }, []);

  return (
    <div className={`Puck ${getClassName()}`}>
      <DragDropContext disableAutoScroll={dnd?.disableAutoScroll}>
        <CustomPuck>
          {children || (
            <div
              className={getLayoutClassName({
                leftSideBarVisible,
                menuOpen,
                mounted,
                rightSideBarVisible,
              })}
            >
              <div className={getLayoutClassName("inner")}>
                <CustomHeader
                  actions={
                    <>
                      <CustomHeaderActions>
                        <Button
                          onClick={() => {
                            const data = useAppStore.getState().state.data;
                            onPublish && onPublish(data as G["UserData"]);
                          }}
                          icon={<Globe size="14px" />}
                        >
                          Publish
                        </Button>
                      </CustomHeaderActions>
                    </>
                  }
                >
                  <header className={getLayoutClassName("header")}>
                    <div className={getLayoutClassName("headerInner")}>
                      <div className={getLayoutClassName("headerToggle")}>
                        <div
                          className={getLayoutClassName("leftSideBarToggle")}
                        >
                          <IconButton
                            onClick={() => {
                              toggleSidebars("left");
                            }}
                            title="Toggle left sidebar"
                          >
                            <PanelLeft focusable="false" />
                          </IconButton>
                        </div>
                        <div
                          className={getLayoutClassName("rightSideBarToggle")}
                        >
                          <IconButton
                            onClick={() => {
                              toggleSidebars("right");
                            }}
                            title="Toggle right sidebar"
                          >
                            <PanelRight focusable="false" />
                          </IconButton>
                        </div>
                      </div>
                      <div className={getLayoutClassName("headerTitle")}>
                        <Heading rank="2" size="xs">
                          {headerTitle || rootProps?.title || "Page"}
                          {headerPath && (
                            <>
                              {" "}
                              <code
                                className={getLayoutClassName("headerPath")}
                              >
                                {headerPath}
                              </code>
                            </>
                          )}
                        </Heading>
                      </div>
                      <div className={getLayoutClassName("headerTools")}>
                        <div className={getLayoutClassName("menuButton")}>
                          <IconButton
                            onClick={() => {
                              return setMenuOpen(!menuOpen);
                            }}
                            title="Toggle menu bar"
                          >
                            {menuOpen ? (
                              <ChevronUp focusable="false" />
                            ) : (
                              <ChevronDown focusable="false" />
                            )}
                          </IconButton>
                        </div>
                        <MenuBar<G["UserData"]>
                          dispatch={dispatch}
                          onPublish={onPublish}
                          menuOpen={menuOpen}
                          renderHeaderActions={() => (
                            <CustomHeaderActions>
                              <Button
                                onClick={() => {
                                  const data = useAppStore.getState().state
                                    .data as G["UserData"];
                                  onPublish && onPublish(data);
                                }}
                                icon={<Globe size="14px" />}
                              >
                                Publish
                              </Button>
                            </CustomHeaderActions>
                          )}
                          setMenuOpen={setMenuOpen}
                        />
                      </div>
                    </div>
                  </header>
                </CustomHeader>
                <div className={getLayoutClassName("leftSideBar")}>
                  <SidebarSection title="Components" noBorderTop>
                    <Components />
                  </SidebarSection>
                  <SidebarSection title="Outline">
                    <Outline />
                  </SidebarSection>
                </div>
                <Canvas />
                <div className={getLayoutClassName("rightSideBar")}>
                  <FieldSideBar />
                </div>
              </div>
            </div>
          )}
        </CustomPuck>
      </DragDropContext>
      <div id="puck-portal-root" className={getClassName("portal")} />
    </div>
  );
}

Puck.Components = Components;
Puck.Fields = Fields;
Puck.Outline = Outline;
Puck.Preview = Preview;
