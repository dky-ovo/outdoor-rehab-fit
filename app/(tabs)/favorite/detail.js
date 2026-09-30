import React from "react";
import Detail from "../outdoor/detail";
import useFavoriteDetailBack from "../../../hooks/useFavoriteDetailBack";

export default function FavoriteDetail() {
	const onFavoriteBack = useFavoriteDetailBack();
	return <Detail onFavoriteBack={onFavoriteBack} />;
}
