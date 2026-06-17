import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";
import type { Ticket } from "./generated/api.schemas";

export const getResolveTicketUrl = (id: number) => `/api/tickets/${id}/resolve`;

export const resolveTicket = async (
  id: number,
  options?: RequestInit,
): Promise<Ticket> => {
  return customFetch<Ticket>(getResolveTicketUrl(id), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
};

export const getResolveTicketMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof resolveTicket>>,
    TError,
    { id: number },
    TContext
  >;
  request?: RequestInit;
}): UseMutationOptions<
  Awaited<ReturnType<typeof resolveTicket>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationKey = ["resolveTicket"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn = (props: { id: number }) => {
    const { id } = props ?? {};
    return resolveTicket(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type ResolveTicketMutationResult = NonNullable<
  Awaited<ReturnType<typeof resolveTicket>>
>;
export type ResolveTicketMutationError = ErrorType<unknown>;

export const useResolveTicket = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof resolveTicket>>,
    TError,
    { id: number },
    TContext
  >;
  request?: RequestInit;
}): UseMutationResult<
  Awaited<ReturnType<typeof resolveTicket>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationOptions = getResolveTicketMutationOptions(options);
  return useMutation(mutationOptions);
};
