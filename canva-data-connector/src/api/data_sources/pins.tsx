import type { DataTableImageUpload } from "@canva/intents/data";
import { Button, DatabaseIcon, HorizontalCard, Rows } from "@canva/app-ui-kit";
import { useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import { Header } from "src/components";
import { useAppContext } from "src/context";
import { Paths } from "src/routes/paths";
import { DataSourceHandler } from "../data_source";
import type { APIResponseItem, DataSourceConfig } from "../data_source";
import { mediaCell, stringCell } from "src/utils";

/** Pin data source config - simple, no filters needed */
export interface PinsDataSource extends DataSourceConfig {
  schema: "pin/v1";
}

export interface PinRow extends APIResponseItem {
  headline: string;
  image: DataTableImageUpload[];
}

const SAMPLE_IMAGE: DataTableImageUpload = {
  type: "image_upload",
  mimeType: "image/png",
  url: "https://via.placeholder.com/1000x1500.png",
  thumbnailUrl: "https://via.placeholder.com/400x600.png",
  width: 1000,
  height: 1500,
  aiDisclosure: "none",
};

export const pinsSource = new DataSourceHandler<
  PinsDataSource,
  PinRow
>(
  { schema: "pin/v1" },
  [
    { label: "headline", getValue: "headline", toCell: stringCell },
    { label: "image", getValue: "image", toCell: mediaCell },
  ],
  async (_source, _authToken, rowLimit) => {
    const sampleRows: PinRow[] = [
      { id: "pin-1", headline: "Sample Pin Title", image: [SAMPLE_IMAGE] },
      { id: "pin-2", headline: "Another Example Headline", image: [SAMPLE_IMAGE] },
    ];
    return sampleRows.slice(0, rowLimit + 1);
  },
  PinSelection,
  PinSourceConfig,
);

function PinSelection() {
  const intl = useIntl();
  const { setDataSourceHandler } = useAppContext();
  const navigate = useNavigate();

  const handleClick = () => {
    setDataSourceHandler(
      pinsSource as unknown as DataSourceHandler<
        DataSourceConfig,
        APIResponseItem
      >,
    );
    navigate(Paths.DATA_SOURCE_CONFIG);
  };

  return (
    <HorizontalCard
      key="pins"
      title={intl.formatMessage({
        defaultMessage: "Pinterest Pin Data",
        description: "Title of the Pinterest pin data source card in the data source selection screen",
      })}
      thumbnail={{ icon: () => <DatabaseIcon /> }}
      onClick={handleClick}
      description={intl.formatMessage({
        defaultMessage: "Sample headline + image for pin templates (used by BoxNCase pipeline)",
        description: "Description of the Pinterest pin data source for the data connector",
      })}
      ariaLabel={intl.formatMessage({
        defaultMessage: "Load pin data",
        description: "Accessible label for the Pinterest pin data source button",
      })}
    />
  );
}

function PinSourceConfig(sourceConfig: PinsDataSource) {
  const intl = useIntl();
  const { loadDataSource } = useAppContext();
  const [isLoading, setIsLoading] = useState(false);

  const loadPins = async () => {
    setIsLoading(true);
    await loadDataSource(
      intl.formatMessage({
        defaultMessage: "Pinterest Pin Data",
        description: "Title shown when loading pin data",
      }),
      sourceConfig,
    );
    setIsLoading(false);
  };

  return (
    <div>
      <Rows spacing="2u">
        <Header
          title={intl.formatMessage({
            defaultMessage: "Pinterest Pin Data",
            description: "Header title for the pin data configuration screen",
          })}
          showBack={true}
        />
        <Button
          variant="primary"
          loading={isLoading}
          onClick={loadPins}
        >
          {intl.formatMessage({
            defaultMessage: "Load Pin Data",
            description: "Button to load sample pin data into the design",
          })}
        </Button>
      </Rows>
    </div>
  );
}
