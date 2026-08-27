import type {
  CognitePort,
  FilterDefinition,
  InstancesQueryRequest,
  QueryNodeTableExpression,
  QuerySelectExpression,
  QueryTableExpression,
  TableExpressionFilter,
  ViewDefinition,
  ViewReference,
} from "../cognite";
import { DEFAULT_LIMIT, EDGE_MARKER, MAX_LIMIT, MAX_QUERY_ROOTS, NESTED_SEP } from "../constants";
import type {
  QueryManyOptions,
  QueryOptions,
  QueryRootSpec,
  QuerySelect,
  SortDirection,
} from "../types";
import {
  buildSelect,
  getDirectRelationSource,
  isEdgeConnection,
  isReverseDirectRelation,
  isViewPropertyDefinition,
  toViewReference,
} from "../utils";
import { QueryValidator } from "../validators";
import { FilterMapper } from "./filter-mapper";
import { SortMapper } from "./sort-mapper";
import type { ViewMapper } from "./view-mapper";

export class QueryMapper {
  private readonly filterMapper: FilterMapper;
  private readonly sortMapper: SortMapper;
  private readonly validator: QueryValidator;

  constructor(
    private readonly viewMapper: ViewMapper,
    cognite: CognitePort,
  ) {
    this.filterMapper = new FilterMapper(viewMapper, cognite);
    this.sortMapper = new SortMapper();
    this.validator = new QueryValidator(viewMapper);
  }

  async map<TModel>(options: QueryOptions<TModel>): Promise<InstancesQueryRequest> {
    return this.mapMany({
      roots: [
        {
          key: options.viewExternalId,
          viewExternalId: options.viewExternalId,
          ...(options.select !== undefined
            ? { select: options.select as Record<string, unknown> }
            : {}),
          ...(options.filters !== undefined
            ? { filters: options.filters as Record<string, unknown> }
            : {}),
          ...(options.sort !== undefined
            ? { sort: options.sort as Record<string, SortDirection> }
            : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        },
      ],
    });
  }

  async mapMany(options: QueryManyOptions): Promise<InstancesQueryRequest> {
    this.validateManyOptions(options);

    const withExprs: Record<string, QueryTableExpression> = {};
    const selectExprs: Record<string, QuerySelectExpression | Record<string, never>> = {};
    const cursors: Record<string, string> = {};

    for (const root of options.roots) {
      await this.appendRoot(root, withExprs, selectExprs, cursors);
    }

    return { with: withExprs, select: selectExprs, cursors };
  }

  private validateManyOptions(options: QueryManyOptions): void {
    const { roots } = options;
    if (!Array.isArray(roots) || roots.length === 0) {
      throw new Error("Invalid queryMany options:\n- roots: at least one root is required");
    }
    if (roots.length > MAX_QUERY_ROOTS) {
      throw new Error(
        `Invalid queryMany options:\n- roots: at most ${MAX_QUERY_ROOTS} roots are allowed`,
      );
    }

    const seen = new Set<string>();
    const errors: string[] = [];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (root == null || typeof root.key !== "string" || root.key.length === 0) {
        errors.push(`roots.${i}.key: must be a non-empty string`);
        continue;
      }
      if (root.key.includes(NESTED_SEP)) {
        errors.push(`roots.${i}.key: must not contain "${NESTED_SEP}"`);
      }
      if (seen.has(root.key)) {
        errors.push(`roots.${i}.key: duplicate key "${root.key}"`);
      }
      seen.add(root.key);
    }

    if (errors.length > 0) {
      throw new Error(`Invalid queryMany options:\n${errors.map((e) => `- ${e}`).join("\n")}`);
    }
  }

  private async appendRoot(
    root: QueryRootSpec,
    withExprs: Record<string, QueryTableExpression>,
    selectExprs: Record<string, QuerySelectExpression | Record<string, never>>,
    cursors: Record<string, string>,
  ): Promise<void> {
    const {
      key,
      viewExternalId,
      select = { _all: true },
      filters,
      sort = {},
      limit: requestedLimit = DEFAULT_LIMIT,
      cursor = null,
    } = root;
    const limit = requestedLimit === -1 ? MAX_LIMIT : requestedLimit;

    const rootView = await this.viewMapper.getView(viewExternalId);
    await this.validator.validate(
      {
        viewExternalId,
        select,
        filters,
        sort,
        limit: requestedLimit,
        cursor,
      } as QueryOptions<Record<string, unknown>>,
      rootView,
    );
    const rootViewRef = toViewReference(rootView);

    const whereFilters = filters ? await this.filterMapper.map(filters, rootView) : [];

    const baseFilters: FilterDefinition[] = [{ hasData: [rootViewRef] }, ...whereFilters];

    withExprs[key] = {
      nodes: {
        filter: { and: baseFilters } as TableExpressionFilter,
      },
      sort: this.sortMapper.map(sort, rootView),
      limit,
    };

    const properties = await this.includeStatements(
      key,
      rootView,
      select as QuerySelect<Record<string, unknown>>,
      withExprs,
      selectExprs,
    );

    selectExprs[key] = buildSelect(rootViewRef, properties);

    if (cursor != null) cursors[key] = cursor;
  }

  private async includeStatements<TModel>(
    key: string,
    view: ViewDefinition,
    select: QuerySelect<TModel>,
    withExprs: Record<string, QueryTableExpression>,
    selectExprs: Record<string, QuerySelectExpression | Record<string, never>>,
  ): Promise<string[]> {
    const selectProperties: string[] = [];
    const selectRecord = select as Record<string, boolean | object | undefined>;
    for (const [propertyName, property] of Object.entries(view.properties)) {
      const propertyKey = `${key}${NESTED_SEP}${propertyName}`;

      const canIncludeProperty = select._all === true || propertyName in select;
      if (!canIncludeProperty) {
        continue;
      }

      const relationToInclude =
        propertyName in select &&
        selectRecord[propertyName] != null &&
        typeof selectRecord[propertyName] === "object"
          ? selectRecord[propertyName]
          : null;
      if (isViewPropertyDefinition(property)) {
        const relSource = getDirectRelationSource(property);
        if (!relSource) {
          selectProperties.push(propertyName);
        } else {
          selectProperties.push(propertyName);
          const nestedView = await this.viewMapper.getView(relSource.externalId);
          const props =
            relationToInclude != null
              ? await this.includeStatements(
                  propertyKey,
                  nestedView,
                  relationToInclude,
                  withExprs,
                  selectExprs,
                )
              : [];
          if (props.length > 0) {
            (withExprs[propertyKey] as QueryNodeTableExpression) = {
              nodes: {
                from: key,
                direction: "outwards",
                through: { view: toViewReference(view), identifier: propertyName },
              },
              limit: MAX_LIMIT,
            };
            selectExprs[propertyKey] = buildSelect(relSource, props);
          }
        }
      } else if (isReverseDirectRelation(property) && relationToInclude != null) {
        const nestedView = await this.viewMapper.getView(property.source.externalId);
        const props = await this.includeStatements(
          propertyKey,
          nestedView,
          relationToInclude,
          withExprs,
          selectExprs,
        );
        if (!props.includes(property.through.identifier)) {
          props.push(property.through.identifier);
        }
        (withExprs[propertyKey] as QueryNodeTableExpression) = {
          nodes: {
            from: key,
            direction: "inwards",
            through: {
              source: property.through.source as ViewReference,
              identifier: property.through.identifier,
            },
          },
          limit: MAX_LIMIT,
        };
        selectExprs[propertyKey] = buildSelect(property.source, props);
      } else if (isEdgeConnection(property) && relationToInclude != null) {
        const edgePropertyKey = `${propertyKey}${NESTED_SEP}${EDGE_MARKER}`;

        withExprs[edgePropertyKey] = {
          edges: {
            from: key,
            maxDistance: 1,
            filter: {
              equals: { property: ["edge", "type"], value: property.type },
            } as TableExpressionFilter,
            direction: property.direction ?? "outwards",
          },
          limit: MAX_LIMIT,
        };
        (withExprs[propertyKey] as QueryNodeTableExpression) = {
          nodes: { from: edgePropertyKey },
          limit: MAX_LIMIT,
        };
        selectExprs[edgePropertyKey] = {};

        const nestedView = await this.viewMapper.getView(property.source.externalId);
        const props = await this.includeStatements(
          propertyKey,
          nestedView,
          relationToInclude,
          withExprs,
          selectExprs,
        );
        selectExprs[propertyKey] = buildSelect(property.source, props);
      }
    }

    return selectProperties;
  }
}
