import "./endpoint-subset-list.scss";

import React from "react";
import { observer } from "mobx-react";
import { EndpointSubset, Endpoint, EndpointAddress} from "../../api/endpoints";
import { _i18n } from "../../i18n";
import { DrawerItem, DrawerTitle } from "../drawer";
import { Trans } from "@lingui/macro";
import { Table, TableCell, TableHead, TableRow } from "../table";
import { autobind } from "../../utils";
import { lookupApiLink } from "../../api/kube-api";
import { getDetailsUrl } from "../../navigation";
import { Link } from "react-router-dom";

interface Props {
  subset: EndpointSubset;
  endpoint: Endpoint;
}

@observer
export class EndpointSubsetList extends React.Component<Props> {

  getAddressTableRow(ip: string) {
    const { subset } = this.props;
    const address = subset.getAddresses().find(address => address.getId() == ip);
    return this.renderAddressTableRow(address);
  }

  @autobind()
  getNotReadyAddressTableRow(ip: string) {
    const { subset} = this.props;
    const address = subset.getNotReadyAddresses().find(address => address.getId() == ip);
    return this.renderAddressTableRow(address);
  }

  @autobind()
  renderAddressTable(addresses: EndpointAddress[], virtual: boolean) {
    return (
      <div>
        <div className="title flex gaps"><Trans>Addresses</Trans></div>
        <Table
          items={addresses}
          selectable={false}
          virtual={virtual}
          scrollable={false}
          getTableRow={this.getAddressTableRow}
          className="box grow"
        >
          <TableHead>
            <TableCell className="ip">IP</TableCell>
            <TableCell className="name"><Trans>Hostname</Trans></TableCell>
            <TableCell className="target">Target</TableCell>
          </TableHead>
          {
            !virtual && addresses.map(address => this.getAddressTableRow(address.getId()))
          }
        </Table>
      </div>
    );
  }

  @autobind()
  renderAddressTableRow(address: EndpointAddress) {
    const { endpoint } = this.props;
    return (
      <TableRow
        key={address.getId()}
        nowrap
      >
        <TableCell className="ip">{address.ip}</TableCell>
        <TableCell className="name">{address.hostname}</TableCell>
        <TableCell className="target">
          { address.targetRef && (
            <Link to={getDetailsUrl(lookupApiLink(address.getTargetRef(), endpoint))}>
              {address.targetRef.name}
            </Link>
          )}
        </TableCell>
      </TableRow>
    );
  }

  render() {
    const { subset } = this.props;
    const addresses = subset.getAddresses();
    const notReadyAddresses = subset.getNotReadyAddresses();
    const addressesVirtual = addresses.length > 100;
    const notReadyAddressesVirtual = notReadyAddresses.length > 100;

    return(
      <div className="EndpointSubsetList flex column">
        {addresses.length > 0 && (
          <div>
            <div className="title flex gaps"><Trans>Addresses</Trans></div>
            <Table
              items={addresses}
              selectable={false}
              virtual={addressesVirtual}
              scrollable={false}
              getTableRow={this.getAddressTableRow}
              className="box grow"
            >
              <TableHead>
                <TableCell className="ip">IP</TableCell>
                <TableCell className="host"><Trans>Hostname</Trans></TableCell>
                <TableCell className="target">Target</TableCell>
              </TableHead>
              { !addressesVirtual && addresses.map(address => this.getAddressTableRow(address.getId())) }
            </Table>
          </div>
        )}

        {notReadyAddresses.length > 0 && (
          <div>
            <div className="title flex gaps"><Trans>Not Ready Addresses</Trans></div>
            <Table
              items={notReadyAddresses}
              selectable
              virtual={notReadyAddressesVirtual}
              scrollable={false}
              getTableRow={this.getNotReadyAddressTableRow}
              className="box grow"
            >
              <TableHead>
                <TableCell className="ip">IP</TableCell>
                <TableCell className="host"><Trans>Hostname</Trans></TableCell>
                <TableCell className="target">Target</TableCell>
              </TableHead>
              { !notReadyAddressesVirtual && notReadyAddresses.map(address => this.getNotReadyAddressTableRow(address.getId())) }
            </Table>
          </div>
        )}

        <div className="title flex gaps"><Trans>Ports</Trans></div>
        <Table
          selectable={false}
          virtual={false}
          scrollable={false}
          className="box grow"
        >
          <TableHead>
            <TableCell className="port"><Trans>Port</Trans></TableCell>
            <TableCell className="name"><Trans>Name</Trans></TableCell>
            <TableCell className="protocol">Protocol</TableCell>
          </TableHead>
          {
            subset.ports.map(port => {
              return (
                <TableRow
                  key={port.port}
                  nowrap
                >
                  <TableCell className="name">{port.port}</TableCell>
                  <TableCell className="name">{port.name}</TableCell>
                  <TableCell className="node">{port.protocol}</TableCell>
                </TableRow>
              );
            })
          }
        </Table>
      </div>
    );
  }
}
