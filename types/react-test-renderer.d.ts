declare module "react-test-renderer" {
	const renderer: {
		create(element: React.ReactElement): { toJSON(): unknown; unmount(): void };
	};
	export default renderer;
}
