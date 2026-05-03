import Form from "next/form";

export const SignOutForm = ({
  onSignOut,
}: {
  onSignOut: () => Promise<void>;
}) => {
  return (
    <Form action={onSignOut} className="w-full">
      <button
        className="w-full px-1 py-0.5 text-left text-red-500"
        type="submit"
      >
        Sign out
      </button>
    </Form>
  );
};
