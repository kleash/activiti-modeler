package io.github.kleash.activiti.dmn;

import java.util.Locale;
import java.util.Set;

import org.operaton.bpm.dmn.engine.impl.spi.type.DmnDataTypeTransformer;
import org.operaton.bpm.dmn.engine.impl.type.DefaultDataTypeTransformerRegistry;
import org.operaton.bpm.dmn.engine.impl.type.IdentityDataTypeTransformer;

/**
 * Teaches Operaton the FEEL type names of the portable DMN conventions that it has no transformer for.
 *
 * <p>Operaton only knows {@code string}, {@code boolean}, {@code integer}, {@code long}, {@code double} and
 * {@code date}. The portable DMN written by the modeler uses the FEEL names, in particular {@code number}, for which
 * Operaton would log {@code DMN-01006 Unsupported type} on every parse and leave the value untouched. The values are
 * indeed left untouched; this registry only maps those names to the identity transformer so that the warning
 * disappears.
 */
final class FeelTypeRegistry extends DefaultDataTypeTransformerRegistry {

    private static final Set<String> PASS_THROUGH = Set.of("number", "any", "time", "date and time", "context", "list",
        "days and time duration", "years and months duration");

    private static final DmnDataTypeTransformer IDENTITY = new IdentityDataTypeTransformer();

    @Override
    public DmnDataTypeTransformer getTransformer(String typeName) {
        if (typeName != null && PASS_THROUGH.contains(typeName.toLowerCase(Locale.ROOT))) {
            return IDENTITY;
        }
        return super.getTransformer(typeName);
    }
}
