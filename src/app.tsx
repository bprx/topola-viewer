import { onAuthStateChanged, signInWithEmailAndPassword, User } from 'firebase/auth';
import * as H from 'history';
import md5 from 'md5';
import * as queryString from 'query-string';
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useHistory, useLocation } from 'react-router';
import { Redirect, Route, Switch } from 'react-router-dom';
import { Card, Form, FormButton, FormInput, Loader, Message, Portal, Tab } from 'semantic-ui-react';
import { IndiInfo } from 'topola';
import { Changelog } from './changelog';
import {
  Chart,
  ChartType,
  downloadPdf,
  downloadPng,
  downloadSvg,
  printChart,
} from './chart';
import {
  argsToConfig,
  Config,
  ConfigPanel,
  configToArgs,
  DEFALUT_CONFIG,
  Ids,
  Sex,
} from './config';
import { DataSourceEnum, SourceSelection } from './datasource/data_source';
import { EmbeddedDataSource, EmbeddedSourceSpec } from './datasource/embedded';
import {
  GedcomUrlDataSource,
  getSelection,
  UploadedDataSource,
  UploadSourceSpec,
  UrlSourceSpec,
} from './datasource/load_data';
import {
  loadWikiTree,
  PRIVATE_ID_PREFIX,
  WikiTreeDataSource,
  WikiTreeSourceSpec,
} from './datasource/wikitree';
import { Details } from './details/details';
import { auth } from './firebase';
import { Intro } from './intro';
import { TopBar } from './menu/top_bar';
import { analyticsEvent } from './util/analytics';
import { getI18nMessage } from './util/error_i18n';
import { idToIndiMap, TopolaData } from './util/gedcom_util';
import { Media } from './util/media';

/**
 * Load GEDCOM URL from REACT_APP_STATIC_URL environment variable.
 *
 * If this environment variable is provided, the viewer is switched to
 * single-tree mode without the option to load other data.
 */
const staticUrl = process.env.REACT_APP_STATIC_URL;

/** Shows an error message in the middle of the screen. */
function ErrorMessage(props: { message?: string }) {
  return (
    <Message negative className="error">
      <Message.Header>
        <FormattedMessage
          id="error.failed_to_load_file"
          defaultMessage={'Failed to load file'}
        />
      </Message.Header>
      <p>{props.message}</p>
    </Message>
  );
}

interface ErrorPopupProps {
  message?: string;
  open: boolean;
  onDismiss: () => void;
}

/**
 * Shows a dismissable error message in the bottom left corner of the screen.
 */
function ErrorPopup(props: ErrorPopupProps) {
  return (
    <Portal open={props.open} onClose={props.onDismiss}>
      <Message negative className="errorPopup" onDismiss={props.onDismiss}>
        <Message.Header>
          <FormattedMessage id="error.error" defaultMessage={'Error'} />
        </Message.Header>
        <p>{props.message}</p>
      </Message>
    </Portal>
  );
}

enum AppState {
  INITIAL,
  LOADING,
  ERROR,
  SHOWING_CHART,
  LOADING_MORE,
}

type DataSourceSpec =
  | UrlSourceSpec
  | UploadSourceSpec
  | WikiTreeSourceSpec
  | EmbeddedSourceSpec;

/**
 * Arguments passed to the application, primarily through URL parameters.
 * Non-optional arguments get populated with default values.
 */
interface Arguments {
  sourceSpec?: DataSourceSpec;
  selection?: IndiInfo;
  chartType: ChartType;
  standalone: boolean;
  showWikiTreeMenus: boolean;
  freezeAnimation: boolean;
  showSidePanel: boolean;
  config: Config;
}

function getParamFromSearch(name: string, search: queryString.ParsedQuery<string>) {
  const value = search[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Retrieve arguments passed into the application through the URL and uploaded
 * data.
 */
function getArguments(location: H.Location<any>): Arguments {
  const search = queryString.parse(location.search);
  const getParam = (name: string) => getParamFromSearch(name, search);

  const view = getParam('view');
  const chartTypes = new Map<string | undefined, ChartType>([
    ['relatives', ChartType.Relatives],
    ['fancy', ChartType.Fancy],
  ]);

  const hash = getParam('file');
  const url = getParam('url');
  const embedded = getParam('embedded') === 'true'; // False by default.
  var sourceSpec: DataSourceSpec | undefined = undefined;
  if (staticUrl) {
    sourceSpec = {
      source: DataSourceEnum.GEDCOM_URL,
      url: staticUrl,
      handleCors: false,
    };
  } else if (getParam('source') === 'wikitree') {
    const windowSearch = queryString.parse(window.location.search);
    sourceSpec = {
      source: DataSourceEnum.WIKITREE,
      authcode: getParam('authcode') || getParamFromSearch('authcode', windowSearch),
    };
  } else if (hash) {
    sourceSpec = {
      source: DataSourceEnum.UPLOADED,
      hash,
      gedcom: location.state && location.state.data,
      images: location.state && location.state.images,
    };
  } else if (url) {
    sourceSpec = {
      source: DataSourceEnum.GEDCOM_URL,
      url,
      handleCors: getParam('handleCors') !== 'false', // True by default.
    };
  } else if (embedded) {
    sourceSpec = { source: DataSourceEnum.EMBEDDED };
  }

  const indi = getParam('indi');
  const parsedGen = Number(getParam('gen'));
  const selection = indi
    ? { id: indi, generation: !isNaN(parsedGen) ? parsedGen : 0 }
    : undefined;

  return {
    sourceSpec,
    selection,
    // Hourglass is the default view.
    chartType: chartTypes.get(view) || ChartType.Hourglass,

    showSidePanel: getParam('sidePanel') !== 'false', // True by default.
    standalone: getParam('standalone') !== 'false' && !embedded && !staticUrl,
    showWikiTreeMenus: getParam('showWikiTreeMenus') !== 'false', // True by default.
    freezeAnimation: getParam('freeze') === 'true', // False by default
    config: argsToConfig(search),
  };
}

export function App() {
  /** State of the application. */
  const [state, setState] = useState<AppState>(AppState.INITIAL);
  /** Loaded data. */
  const [data, setData] = useState<TopolaData>();
  /** Selected individual. */
  const [selection, setSelection] = useState<IndiInfo>();
  /** Error to display. */
  const [error, setError] = useState<string>();
  /** Whether the side panel is shown. */
  const [showSidePanel, setShowSidePanel] = useState(false);
  /** Whether the app is in standalone mode, i.e. showing 'open file' menus. */
  const [standalone, setStandalone] = useState(true);
  /**
   * Whether the app should display WikiTree-specific menus when showing data
   * from WikiTree.
   */
  const [showWikiTreeMenus, setShowWikiTreeMenus] = useState(true);
  /** Type of displayed chart. */
  const [chartType, setChartType] = useState<ChartType>(ChartType.Hourglass);
  /** Whether to show the error popup. */
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  /** Specification of the source of the data. */
  const [sourceSpec, setSourceSpec] = useState<DataSourceSpec>();
  /** Freeze animations after initial chart render. */
  const [freezeAnimation, setFreezeAnimation] = useState(false);
  const [config, setConfig] = useState(DEFALUT_CONFIG);
  const [famtreeLoaded, setFamtreeLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  const intl = useIntl();
  const history = useHistory();
  const location = useLocation();

  /** Sets the state with a new individual selection and chart type. */
  function updateDisplay(newSelection: IndiInfo) {
    if (
      !selection ||
      selection.id !== newSelection.id ||
      selection!.generation !== newSelection.generation
    ) {
      setSelection(newSelection);
    }
  }

  function toggleDetails(config: Config, data: TopolaData | undefined) {
    if (data === undefined) {
      return;
    }
    let shouldHideIds = config.id === Ids.HIDE;
    let shouldHideSex = config.sex === Sex.HIDE;
    let indiMap = idToIndiMap(data.chartData);
    indiMap.forEach((indi) => {
      indi.hideId = shouldHideIds;
      indi.hideSex = shouldHideSex;
    });
  }

  /** Sets error message after data load failure. */
  function setErrorMessage(message: string) {
    setError(message);
    setState(AppState.ERROR);
  }

  async function fetchFile(filepath: string) {
    // prefix public dir files with `process.env.PUBLIC_URL`
    // see https://create-react-app.dev/docs/using-the-public-folder/
    const res = await fetch(`${process.env.PUBLIC_URL}/${filepath}`);

    // check for errors
    if (!res.ok) {
      throw res;
    }

    return res.text();
  };

  async function handleSignIn() {
    console.log(`sign in: ${email}, ${password}`);
    try {
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      setUser(userCred.user);
      console.log(`signed in: ${user?.uid}`);
    } catch (err) {
      console.log(`Error signing in: ${err}`);
    }
  }

  async function loadFamilyTree() {
    console.log(`start loading family_tree.ged`);
    // const files = (event.target as HTMLInputElement).files;
    // if (!files || !files.length) {
    //   return;
    // }
    // const filesArray = Array.from(files);
    // (event.target as HTMLInputElement).value = ''; // Reset the file input.
    // analyticsEvent('upload_files_selected', {
    //   event_value: files.length,
    // });

    // const gedcomFile =
    //   filesArray.length === 1
    //     ? filesArray[0]
    //     : filesArray.find((file) => file.name.toLowerCase().endsWith('.ged')) ||
    //       filesArray[0];
    // const {gedcom, images} = await loadFile(gedcomFile);

    const gedcom = await fetchFile('family_tree.ged');
    const images = new Map();

    // Convert uploaded images to object URLs.
    // filesArray
    //   .filter(
    //     (file) => file.name !== gedcomFile.name && isImageFileName(file.name),
    //   )
    //   .forEach((file) => images.set(file.name, URL.createObjectURL(file)));

    // Hash GEDCOM contents with uploaded image file names.
    const imageFileNames = Array.from(images.keys()).sort().join('|');
    const hash = md5(md5(gedcom) + imageFileNames);

    // Use history.replace() when reuploading the same file and history.push() when loading
    // a new file.
    const search = queryString.parse(location.search);
    const historyPush = search.file === hash ? history.replace : history.push;

    historyPush({
      pathname: '/view',
      search: queryString.stringify({ file: hash }),
      state: { data: gedcom, images },
    });
  }

  const uploadedDataSource = new UploadedDataSource();
  const gedcomUrlDataSource = new GedcomUrlDataSource();
  const wikiTreeDataSource = new WikiTreeDataSource(intl);
  const embeddedDataSource = new EmbeddedDataSource();

  function isNewData(newSourceSpec: DataSourceSpec, newSelection?: IndiInfo) {
    if (!sourceSpec || sourceSpec.source !== newSourceSpec.source) {
      // New data source means new data.
      return true;
    }
    const newSource = { spec: newSourceSpec, selection: newSelection };
    const oldSouce = {
      spec: sourceSpec,
      selection: selection,
    };
    switch (newSource.spec.source) {
      case DataSourceEnum.UPLOADED:
        return uploadedDataSource.isNewData(
          newSource as SourceSelection<UploadSourceSpec>,
          oldSouce as SourceSelection<UploadSourceSpec>,
          data,
        );
      case DataSourceEnum.GEDCOM_URL:
        return gedcomUrlDataSource.isNewData(
          newSource as SourceSelection<UrlSourceSpec>,
          oldSouce as SourceSelection<UrlSourceSpec>,
          data,
        );
      case DataSourceEnum.WIKITREE:
        return wikiTreeDataSource.isNewData(
          newSource as SourceSelection<WikiTreeSourceSpec>,
          oldSouce as SourceSelection<WikiTreeSourceSpec>,
          data,
        );
      case DataSourceEnum.EMBEDDED:
        return embeddedDataSource.isNewData(
          newSource as SourceSelection<EmbeddedSourceSpec>,
          oldSouce as SourceSelection<EmbeddedSourceSpec>,
          data,
        );
    }
  }

  function loadData(newSourceSpec: DataSourceSpec, newSelection?: IndiInfo) {
    switch (newSourceSpec.source) {
      case DataSourceEnum.UPLOADED:
        return uploadedDataSource.loadData({
          spec: newSourceSpec,
          selection: newSelection,
        });
      case DataSourceEnum.GEDCOM_URL:
        return gedcomUrlDataSource.loadData({
          spec: newSourceSpec,
          selection: newSelection,
        });
      case DataSourceEnum.WIKITREE:
        return wikiTreeDataSource.loadData({
          spec: newSourceSpec,
          selection: newSelection,
        });
      case DataSourceEnum.EMBEDDED:
        return embeddedDataSource.loadData({
          spec: newSourceSpec,
          selection: newSelection,
        });
    }
  }

  useEffect(() => {
    onAuthStateChanged(auth, (user) => {
      console.log(`onAuthStateChanged is triggered, user = ${user?.email}`);
      setUser(user);
    });
  }, []);

  useEffect(() => {
    (async () => {
      if (!famtreeLoaded) {
        await loadFamilyTree();
        setFamtreeLoaded(true);
      }

      if (location.pathname !== '/view') {
        if (state !== AppState.INITIAL) {
          setState(AppState.INITIAL);
        }
        return;
      }

      const args = getArguments(location);

      if (!args.sourceSpec) {
        history.replace({ pathname: '/' });
        return;
      }

      if (
        state === AppState.INITIAL ||
        isNewData(args.sourceSpec, args.selection)
      ) {
        // Set loading state.
        setState(AppState.LOADING);
        // Set state from URL parameters.
        setSourceSpec(args.sourceSpec);
        setSelection(args.selection);
        setStandalone(args.standalone);
        setShowWikiTreeMenus(args.showWikiTreeMenus);
        setChartType(args.chartType);
        setFreezeAnimation(args.freezeAnimation);
        setConfig(args.config);
        try {
          const data = await loadData(args.sourceSpec, args.selection);
          // Set state with data.
          setData(data);
          toggleDetails(args.config, data);
          setShowSidePanel(args.showSidePanel);
          setState(AppState.SHOWING_CHART);
        } catch (error: any) {
          setErrorMessage(getI18nMessage(error, intl));
        }
      } else if (
        state === AppState.SHOWING_CHART ||
        state === AppState.LOADING_MORE
      ) {
        // Update selection if it has changed in the URL.
        const loadMoreFromWikitree =
          args.sourceSpec.source === DataSourceEnum.WIKITREE &&
          (!selection || selection.id !== args.selection?.id);
        setChartType(args.chartType);
        setState(
          loadMoreFromWikitree ? AppState.LOADING_MORE : AppState.SHOWING_CHART,
        );
        updateDisplay(args.selection!);
        if (loadMoreFromWikitree) {
          try {
            const data = await loadWikiTree(args.selection!.id, intl);
            const newSelection = getSelection(data.chartData, args.selection);
            setData(data);
            setSelection(newSelection);
            setState(AppState.SHOWING_CHART);
          } catch (error: any) {
            setState(AppState.SHOWING_CHART);
            displayErrorPopup(
              intl.formatMessage(
                {
                  id: 'error.failed_wikitree_load_more',
                  defaultMessage: 'Failed to load data from WikiTree. {error}',
                },
                { error },
              ),
            );
          }
        }
      }
    })();
  });

  function updateUrl(args: queryString.ParsedQuery<any>) {
    const search = queryString.parse(location.search);
    for (const key in args) {
      search[key] = args[key];
    }
    location.search = queryString.stringify(search);
    history.push(location);
  }

  /**
   * Called when the user clicks an individual box in the chart.
   * Updates the browser URL.
   */
  function onSelection(selection: IndiInfo) {
    // Don't allow selecting WikiTree private profiles.
    if (selection.id.startsWith(PRIVATE_ID_PREFIX)) {
      return;
    }
    analyticsEvent('selection_changed');
    updateUrl({
      indi: selection.id,
      gen: selection.generation,
    });
  }

  function onPrint() {
    analyticsEvent('print');
    printChart();
  }

  function displayErrorPopup(message: string) {
    setShowErrorPopup(true);
    setError(message);
  }

  async function onDownloadPdf() {
    analyticsEvent('download_pdf');
    try {
      await downloadPdf();
    } catch (e) {
      displayErrorPopup(
        intl.formatMessage({
          id: 'error.failed_pdf',
          defaultMessage:
            'Failed to generate PDF file.' +
            ' Please try with a smaller diagram or download an SVG file.',
        }),
      );
    }
  }

  async function onDownloadPng() {
    analyticsEvent('download_png');
    try {
      await downloadPng();
    } catch (e) {
      displayErrorPopup(
        intl.formatMessage({
          id: 'error.failed_png',
          defaultMessage:
            'Failed to generate PNG file.' +
            ' Please try with a smaller diagram or download an SVG file.',
        }),
      );
    }
  }

  function onDownloadSvg() {
    analyticsEvent('download_svg');
    downloadSvg();
  }

  function onDismissErrorPopup() {
    setShowErrorPopup(false);
  }

  function renderMainArea() {
    switch (state) {
      case AppState.SHOWING_CHART:
      case AppState.LOADING_MORE:
        const updatedSelection = getSelection(data!.chartData, selection);
        const sidePanelTabs = [
          {
            menuItem: intl.formatMessage({
              id: 'tab.info',
              defaultMessage: 'Info',
            }),
            render: () => (
              <Details gedcom={data!.gedcom} indi={updatedSelection.id} />
            ),
          },
          {
            menuItem: intl.formatMessage({
              id: 'tab.settings',
              defaultMessage: 'Settings',
            }),
            render: () => (
              <ConfigPanel
                config={config}
                onChange={(config) => {
                  setConfig(config);
                  toggleDetails(config, data);
                  updateUrl(configToArgs(config));
                }}
              />
            ),
          },
        ];
        return (
          <div id="content">
            <ErrorPopup
              open={showErrorPopup}
              message={error}
              onDismiss={onDismissErrorPopup}
            />
            {state === AppState.LOADING_MORE ? (
              <Loader active size="small" className="loading-more" />
            ) : null}
            <Chart
              data={data!.chartData}
              selection={updatedSelection}
              chartType={chartType}
              onSelection={onSelection}
              freezeAnimation={freezeAnimation}
              colors={config.color}
              hideIds={config.id}
              hideSex={config.sex}
            />
            {showSidePanel ? (
              <Media greaterThanOrEqual="large" className="sidePanel">
                <Tab panes={sidePanelTabs} />
              </Media>
            ) : null}
            <Changelog />
          </div>
        );

      case AppState.ERROR:
        return <ErrorMessage message={error!} />;

      case AppState.INITIAL:
      case AppState.LOADING:
        return <Loader active size="large" />;
    }
  }

  return (
    <>
      <Route
        render={() => (
          <TopBar
            data={data?.chartData}
            allowAllRelativesChart={
              sourceSpec?.source !== DataSourceEnum.WIKITREE
            }
            showingChart={
              history.location.pathname === '/view' &&
              (state === AppState.SHOWING_CHART ||
                state === AppState.LOADING_MORE)
            }
            standalone={standalone}
            eventHandlers={{
              onSelection,
              onPrint,
              onDownloadPdf,
              onDownloadPng,
              onDownloadSvg,
            }}
            showWikiTreeMenus={
              sourceSpec?.source === DataSourceEnum.WIKITREE &&
              showWikiTreeMenus
            }
          />
        )}
      />
      {user ? (
        <Switch>
          <Route exact path="/" component={Intro} />
          <Route exact path="/view" render={renderMainArea} />
          <Redirect to={'/'} />
        </Switch>
      ) : (
        // <Switch>
        //   <Route exact path="/view" render={renderMainArea} />
        //   <Redirect to={'/view'} />
        // </Switch>
        <Switch>
          <Route render={() => (
            <div id="content">
              <div className="backgroundImage" />
              <Card className="intro">
                <Card.Content as={Media} greaterThanOrEqual="large">
                  <Card.Header>
                    <FormattedMessage
                      id="intro.title"
                      defaultMessage="Topola Genealogy Viewer"
                    />
                  </Card.Header>
                </Card.Content>
                <Card.Content>
                  <p>Please enter your email address and password:</p>
                  <Form onSubmit={handleSignIn}>
                    <FormInput
                      placeholder='Email'
                      type="email"
                      fluid
                      name='email'
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <FormInput
                      type="password"
                      fluid
                      name='password'
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <FormButton content='Submit' />
                  </Form>
                </Card.Content>
              </Card>
            </div>
          )} />
        </Switch>
      )}
    </>
  );
}

